import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { settingsJsonToRules } from '../src/utils/permissions/permissionsLoader.ts'
import { validateTranscriptContent } from '../src/utils/sessionImport.ts'
import type { SettingsJson } from '../src/utils/settings/types.ts'

// --- Named permission profiles -------------------------------------------

const base: SettingsJson = {
  permissions: {
    allow: ['Read'],
    deny: ['Bash(rm:*)'],
    profiles: {
      reviewing: {
        allow: ['Grep', 'Glob'],
        deny: ['Edit', 'Write'],
        description: 'Read-only code review',
      },
      trusted: {
        allow: ['Bash(git:*)'],
      },
    },
  },
}

test('permission profiles: active profile rules are appended to the base', () => {
  const withProfile: SettingsJson = {
    permissions: { ...base.permissions, activeProfile: 'reviewing' },
  }
  const rules = settingsJsonToRules(withProfile, 'userSettings')
  const byBehavior = (behavior: string) =>
    rules.filter(rule => rule.ruleBehavior === behavior).length
  // Base: 1 allow + 1 deny. Profile "reviewing": 2 allow + 2 deny.
  expect(byBehavior('allow')).toBe(3)
  expect(byBehavior('deny')).toBe(3)
  // Profile rules must carry the source they came from, like base rules.
  expect(rules.every(rule => rule.source === 'userSettings')).toBe(true)
})

test('permission profiles: no active profile means base rules only', () => {
  const rules = settingsJsonToRules(base, 'userSettings')
  expect(rules).toHaveLength(2)
})

test('permission profiles: a misnamed profile contributes nothing, never throws', () => {
  const misnamed: SettingsJson = {
    permissions: { ...base.permissions, activeProfile: 'does-not-exist' },
  }
  expect(settingsJsonToRules(misnamed, 'userSettings')).toHaveLength(2)
})

test('permission profiles: switching profiles switches the appended rules', () => {
  const trusted: SettingsJson = {
    permissions: { ...base.permissions, activeProfile: 'trusted' },
  }
  const rules = settingsJsonToRules(trusted, 'userSettings')
  expect(rules).toHaveLength(3)
  expect(
    rules.filter(rule => rule.ruleBehavior === 'deny'),
  ).toHaveLength(1)
})

// --- Session import -------------------------------------------------------

function lines(...entries: unknown[]): string {
  return entries.map(entry => JSON.stringify(entry)).join('\n')
}

test('session import: accepts a well-formed transcript', () => {
  const content = lines(
    { type: 'user', message: { content: 'hello' } },
    { type: 'assistant', message: { content: 'hi' } },
  )
  const result = validateTranscriptContent(content)
  expect(result.valid).toBe(true)
  expect(result.messageCount).toBe(2)
})

test('session import: rejects non-JSON, non-object, and untyped content', () => {
  expect(validateTranscriptContent('not json at all').valid).toBe(false)
  expect(validateTranscriptContent('[1,2,3]').valid).toBe(false)
  // Valid JSON objects but nothing resembling a transcript entry.
  expect(validateTranscriptContent(lines({ a: 1 }, { b: 2 })).valid).toBe(
    false,
  )
  expect(validateTranscriptContent('').valid).toBe(false)
})

test('session import: one corrupt line rejects the whole file', () => {
  // Silently dropping lines would corrupt resume history, so imports are
  // all-or-nothing.
  const content =
    lines({ type: 'user', message: {} }) + '\n{broken json\n'
  const result = validateTranscriptContent(content)
  expect(result.valid).toBe(false)
  expect(result.errors.join(' ')).toContain('line 2')
})

test('session import: importSessionFile refuses missing and invalid files', async () => {
  const { importSessionFile } = await import('../src/utils/sessionImport.ts')
  expect(() => importSessionFile('/nonexistent/nowhere.jsonl')).toThrow(
    /No such file/,
  )
  const dir = mkdtempSync(join(tmpdir(), 'ur-import-'))
  try {
    const bad = join(dir, 'bad.jsonl')
    writeFileSync(bad, 'garbage')
    expect(() => importSessionFile(bad)).toThrow(/Invalid session file/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// --- Background agent lifecycle hooks -------------------------------------

test('background agent transitions fire Notification hooks', () => {
  // Structural regression guard: completion and failure must both route
  // through executeNotificationHooks with distinct, documented types that
  // users can match on from their hook config.
  const source = readFileSync(
    'src/tasks/LocalAgentTask/LocalAgentTask.tsx',
    'utf8',
  )
  expect(source).toContain("notificationType: 'agent_completed'")
  expect(source).toContain("notificationType: 'agent_failed'")
  expect(source).toContain('executeNotificationHooks')
})

// --- Permission profile switching -----------------------------------------

test('profile switching writes to the source that defines the profile', async () => {
  const { listProfiles, setActiveProfile, findProfileSource } = await import(
    '../src/utils/permissions/profiles.ts'
  )
  const store: Record<string, SettingsJson | null> = {
    localSettings: null,
    projectSettings: {
      permissions: {
        profiles: { reviewing: { deny: ['Edit'], description: 'read only' } },
      },
    },
    userSettings: { permissions: { profiles: { trusted: { allow: ['Bash'] } } } },
  }
  const read = (source: string) => store[source] ?? null
  const writes: string[] = []
  const write = (source: string, settings: SettingsJson) => {
    writes.push(source)
    store[source] = settings
    return { error: null }
  }

  expect(listProfiles(read as never).map(p => p.name)).toEqual([
    'reviewing',
    'trusted',
  ])
  expect(findProfileSource('trusted', read as never)).toBe('userSettings')

  // The switch lands beside the definition, not in a shadowing file.
  const result = setActiveProfile('reviewing', {
    read: read as never,
    write: write as never,
  })
  expect(result.ok).toBe(true)
  expect(writes).toEqual(['projectSettings'])
  expect(store.projectSettings?.permissions?.activeProfile).toBe('reviewing')
})

test('switching to an unknown profile fails and names the known ones', async () => {
  const { setActiveProfile } = await import(
    '../src/utils/permissions/profiles.ts'
  )
  const read = () =>
    ({ permissions: { profiles: { trusted: {} } } }) as SettingsJson
  const result = setActiveProfile('nope', {
    read: read as never,
    write: (() => ({ error: null })) as never,
  })
  expect(result.ok).toBe(false)
  expect(result.error).toContain('trusted')
})
