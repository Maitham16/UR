import { describe, expect, test } from 'bun:test'
import { buildDefaultStatusBar } from '../src/utils/statusBar.js'
import {
  defaultStatusBarFieldVisibility,
  isStatusBarFieldId,
  resolveStatusBarFieldVisibility,
  STATUS_BAR_FIELDS,
  visibleStatusBarFieldIds,
} from '../src/utils/statusBarFields.js'
import { describeStatusBarSelection } from '../src/commands/status-bar/statusBarSettings.js'

const BASE = { version: '1.0.0' }

describe('field registry', () => {
  test('every field id is unique', () => {
    const ids = STATUS_BAR_FIELDS.map(f => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('every field has a distinct priority so dropping is deterministic', () => {
    const priorities = STATUS_BAR_FIELDS.map(f => f.priority)
    expect(new Set(priorities).size).toBe(priorities.length)
  })

  test('attention outranks every other field', () => {
    const attention = STATUS_BAR_FIELDS.find(f => f.id === 'attention')!
    for (const field of STATUS_BAR_FIELDS) {
      if (field.id === 'attention') continue
      expect(attention.priority).toBeGreaterThan(field.priority)
    }
  })

  test('sensible defaults: the common fields are on, the noisy ones off', () => {
    const defaults = defaultStatusBarFieldVisibility()
    expect(defaults.model).toBe(true)
    expect(defaults.state).toBe(true)
    expect(defaults.attention).toBe(true)
    expect(defaults.runtime).toBe(false)
    expect(defaults.tokens).toBe(false)
  })
})

describe('visibility resolution', () => {
  test('no saved settings yields the defaults', () => {
    expect(resolveStatusBarFieldVisibility(undefined)).toEqual(defaultStatusBarFieldVisibility())
    expect(resolveStatusBarFieldVisibility(null)).toEqual(defaultStatusBarFieldVisibility())
  })

  test('a saved choice overrides the default', () => {
    const resolved = resolveStatusBarFieldVisibility({ runtime: true, model: false })
    expect(resolved.runtime).toBe(true)
    expect(resolved.model).toBe(false)
    expect(resolved.branch).toBe(true)
  })

  test('unknown ids and non-boolean values are ignored', () => {
    const resolved = resolveStatusBarFieldVisibility({
      notAField: true,
      model: 'yes',
      runtime: true,
    })
    expect(resolved).not.toHaveProperty('notAField')
    expect(resolved.model).toBe(true)
    expect(resolved.runtime).toBe(true)
  })

  test('id guard accepts known ids only', () => {
    expect(isStatusBarFieldId('model')).toBe(true)
    expect(isStatusBarFieldId('nope')).toBe(false)
    expect(isStatusBarFieldId(7)).toBe(false)
  })

  test('visible ids follow declaration order', () => {
    const ids = visibleStatusBarFieldIds(defaultStatusBarFieldVisibility())
    expect(ids[0]).toBe('attention')
    expect(ids).toContain('branch')
    expect(ids).not.toContain('runtime')
  })
})

describe('composition', () => {
  test('an empty bar reads ready rather than blank', () => {
    expect(buildDefaultStatusBar(BASE)).toBe('ready')
  })

  test('fields turned off do not appear', () => {
    const line = buildDefaultStatusBar({
      ...BASE,
      model: 'gpt-5',
      branch: 'main',
      fieldVisibility: { branch: false },
    })
    expect(line).toContain('gpt-5')
    expect(line).not.toContain('main')
  })

  test('task progress shows completed out of total', () => {
    const line = buildDefaultStatusBar({
      ...BASE,
      taskTotalCount: 8,
      taskCompletedCount: 3,
      taskRunningCount: 2,
    })
    expect(line).toContain('3/8 done')
    expect(line).toContain('2 running')
  })

  test('progress omits the running clause when nothing is running', () => {
    const line = buildDefaultStatusBar({
      ...BASE,
      taskTotalCount: 8,
      taskCompletedCount: 8,
      taskRunningCount: 0,
    })
    expect(line).toContain('8/8 done')
    expect(line).not.toContain('running')
  })

  test('no task field at all when there is no task list', () => {
    expect(buildDefaultStatusBar({ ...BASE, taskTotalCount: 0 })).toBe('ready')
  })

  test('agent count is singular and plural correctly, and hidden at zero', () => {
    expect(buildDefaultStatusBar({ ...BASE, activeAgentCount: 1 })).toContain('1 agent')
    expect(buildDefaultStatusBar({ ...BASE, activeAgentCount: 4 })).toContain('4 agents')
    expect(buildDefaultStatusBar({ ...BASE, activeAgentCount: 0 })).toBe('ready')
  })

  test('token usage is omitted unless real and enabled', () => {
    const enabled = { tokens: true }
    expect(buildDefaultStatusBar({ ...BASE, totalTokens: 0, fieldVisibility: enabled })).toBe('ready')
    expect(buildDefaultStatusBar({ ...BASE, totalTokens: null, fieldVisibility: enabled })).toBe('ready')
    expect(
      buildDefaultStatusBar({ ...BASE, totalTokens: 12500, fieldVisibility: enabled }),
    ).toContain('12.5K tok')
    // Off by default, so a real figure still does not appear unprompted.
    expect(buildDefaultStatusBar({ ...BASE, totalTokens: 12500 })).toBe('ready')
  })

  test('runtime formats and is omitted at zero', () => {
    const enabled = { runtime: true }
    expect(buildDefaultStatusBar({ ...BASE, runtimeMs: 45_000, fieldVisibility: enabled })).toContain('45s')
    expect(buildDefaultStatusBar({ ...BASE, runtimeMs: 125_000, fieldVisibility: enabled })).toContain('2m 5s')
    expect(buildDefaultStatusBar({ ...BASE, runtimeMs: 0, fieldVisibility: enabled })).toBe('ready')
  })

  test('context percent is clamped and hidden at zero', () => {
    expect(buildDefaultStatusBar({ ...BASE, contextPercent: 42.4 })).toContain('ctx 42%')
    expect(buildDefaultStatusBar({ ...BASE, contextPercent: 150 })).toContain('ctx 100%')
    expect(buildDefaultStatusBar({ ...BASE, contextPercent: 0 })).toBe('ready')
  })

  test('update appears only when a newer version exists', () => {
    expect(buildDefaultStatusBar({ ...BASE, latestVersion: '2.0.0' })).toContain('update 2.0.0')
    expect(buildDefaultStatusBar({ ...BASE, latestVersion: '1.0.0' })).toBe('ready')
  })

  test('HEAD is not shown as a branch', () => {
    expect(buildDefaultStatusBar({ ...BASE, branch: 'HEAD' })).toBe('ready')
  })
})

describe('no repeated or conflicting information', () => {
  test('two fields resolving to the same text render once', () => {
    const line = buildDefaultStatusBar({
      ...BASE,
      model: 'sonnet',
      providerLabel: 'sonnet',
    })
    expect(line.split('sonnet')).toHaveLength(2)
  })

  test('checksStatus is not duplicated when it equals attention', () => {
    const line = buildDefaultStatusBar({
      ...BASE,
      attention: 'build failed',
      checksStatus: 'build failed',
    })
    expect(line.split('build failed')).toHaveLength(2)
  })
})

describe('narrow terminals', () => {
  const wide = {
    ...BASE,
    state: 'working',
    model: 'claude-opus-4-6-20260101',
    activeTask: 'Refactor the provider registry module',
    taskTotalCount: 9,
    taskCompletedCount: 4,
    taskRunningCount: 1,
    activeAgentCount: 3,
    providerLabel: 'Anthropic API',
    mode: 'acceptEdits',
    branch: 'feat/status-bar',
    contextPercent: 61,
  }

  test('a wide terminal shows everything', () => {
    const line = buildDefaultStatusBar({ ...wide, columns: 200 })
    expect(line).toContain('working')
    expect(line).toContain('feat/status-bar')
    expect(line).toContain('Anthropic API')
    expect(line).toContain('ctx 61%')
  })

  test('a narrow terminal drops low-priority fields, not high ones', () => {
    const line = buildDefaultStatusBar({ ...wide, columns: 40 })
    expect(line.length).toBeLessThanOrEqual(40)
    expect(line).toContain('working')
    expect(line).not.toContain('feat/status-bar')
  })

  test('errors survive even at extreme narrowness', () => {
    const line = buildDefaultStatusBar({ ...wide, attention: 'API key invalid', columns: 20 })
    expect(line.length).toBeLessThanOrEqual(20)
    expect(line).toContain('API key')
  })

  test('every width from 10 to 200 stays within bounds', () => {
    for (let columns = 10; columns <= 200; columns += 1) {
      const line = buildDefaultStatusBar({ ...wide, columns })
      expect(line.length).toBeLessThanOrEqual(columns)
    }
  })

  test('an unknown width composes every visible field', () => {
    const line = buildDefaultStatusBar({ ...wide, columns: null })
    expect(line).toContain('feat/status-bar')
    expect(line).toContain('Anthropic API')
    expect(line).toContain('3 agents')
  })
})

describe('long names', () => {
  test('a very long model name is clipped, not allowed to fill the bar', () => {
    const line = buildDefaultStatusBar({
      ...BASE,
      model: 'x'.repeat(200),
      branch: 'main',
      columns: 120,
    })
    expect(line.length).toBeLessThanOrEqual(120)
    expect(line).toContain('…')
  })

  test('a long branch name is clipped', () => {
    const line = buildDefaultStatusBar({ ...BASE, branch: 'b'.repeat(100) })
    expect(line.length).toBeLessThan(100)
  })
})

describe('stability across rapid updates', () => {
  test('identical input yields identical output', () => {
    const input = { ...BASE, model: 'gpt-5', taskTotalCount: 3, taskCompletedCount: 1 }
    const first = buildDefaultStatusBar(input)
    for (let i = 0; i < 50; i++) {
      expect(buildDefaultStatusBar(input)).toBe(first)
    }
  })

  test('only the changed field changes the line', () => {
    const base = { ...BASE, model: 'gpt-5', taskTotalCount: 3, taskCompletedCount: 1 }
    const before = buildDefaultStatusBar(base)
    const after = buildDefaultStatusBar({ ...base, taskCompletedCount: 2 })
    expect(before).not.toBe(after)
    expect(after).toContain('2/3 done')
  })
})

describe('settings summary', () => {
  test('the saved selection is described back to the user', () => {
    expect(describeStatusBarSelection(['model', 'branch'])).toContain('Model')
    expect(describeStatusBarSelection(['model', 'branch'])).toContain('Git branch')
  })

  test('an empty selection is stated plainly', () => {
    expect(describeStatusBarSelection([])).toContain('none')
  })
})
