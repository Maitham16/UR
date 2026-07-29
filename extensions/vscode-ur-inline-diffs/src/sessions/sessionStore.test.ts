import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { ChatMessage } from '../bridge/types.js'
import {
  appendMessage,
  archiveSession,
  chatRoot,
  createSession,
  deleteSession,
  listSessions,
  readSession,
  setCliSessionId,
} from './sessionStore.js'

let dir: string
let outsideDir: string | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ur-chat-store-'))
  outsideDir = undefined
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  if (outsideDir) rmSync(outsideDir, { recursive: true, force: true })
})

function userMessage(sessionId: string, text: string): ChatMessage {
  return {
    id: 'm-' + Math.random().toString(36).slice(2),
    sessionId,
    role: 'user',
    content: [{ type: 'text', text }],
    createdAt: new Date().toISOString(),
  }
}

describe('createSession', () => {
  test('writes a session file and a manifest entry under .ur/ide/chat/', () => {
    const record = createSession(dir, { title: 'Debug the parser' })
    expect(record.session.title).toBe('Debug the parser')
    expect(record.messages).toEqual([])
    expect(existsSync(join(chatRoot(dir), 'manifest.json'))).toBe(true)
    expect(existsSync(join(chatRoot(dir), 'sessions', `${record.session.id}.json`))).toBe(true)
  })

  test('defaults to "New Chat" with no title given', () => {
    const record = createSession(dir)
    expect(record.session.title).toBe('New Chat')
  })

  test('never writes outside the given workspace root', () => {
    const record = createSession(dir)
    const file = join(chatRoot(dir), 'sessions', `${record.session.id}.json`)
    expect(file.startsWith(dir)).toBe(true)
  })

  test('refuses a symlinked chat store instead of writing outside the workspace', () => {
    outsideDir = mkdtempSync(join(tmpdir(), 'ur-chat-outside-'))
    mkdirSync(join(dir, '.ur', 'ide'), { recursive: true })
    symlinkSync(outsideDir, chatRoot(dir), 'dir')

    expect(() => createSession(dir)).toThrow(/symbolic link/i)
    expect(readdirSync(outsideDir)).toEqual([])
  })
})

describe('listSessions', () => {
  test('lists newest-updated first', async () => {
    const a = createSession(dir, { title: 'First' })
    await sleep(5)
    const b = createSession(dir, { title: 'Second' })
    const sessions = listSessions(dir)
    expect(sessions.map(s => s.id)).toEqual([b.session.id, a.session.id])
  })

  test('excludes archived sessions by default', () => {
    const a = createSession(dir, { title: 'Keep' })
    const b = createSession(dir, { title: 'Archive me' })
    archiveSession(dir, b.session.id)
    expect(listSessions(dir).map(s => s.id)).toEqual([a.session.id])
    expect(listSessions(dir, { includeArchived: true }).map(s => s.id).sort()).toEqual(
      [a.session.id, b.session.id].sort(),
    )
  })

  test('empty workspace has no sessions', () => {
    expect(listSessions(dir)).toEqual([])
  })

  test('filters structurally invalid manifest entries', () => {
    mkdirSync(chatRoot(dir), { recursive: true })
    writeFileSync(
      join(chatRoot(dir), 'manifest.json'),
      JSON.stringify({
        version: 1,
        sessions: [
          {
            id: 'bad',
            title: 'Redirected',
            workspaceRoot: '/tmp/not-this-workspace',
            createdAt: 'now',
            updatedAt: 'now',
          },
        ],
      }),
    )
    expect(listSessions(dir)).toEqual([])
  })

  test('treats valid JSON with the wrong top-level shape as an empty manifest', () => {
    mkdirSync(chatRoot(dir), { recursive: true })
    writeFileSync(join(chatRoot(dir), 'manifest.json'), 'null')
    expect(listSessions(dir)).toEqual([])
  })
})

describe('readSession', () => {
  test('round-trips a created session', () => {
    const created = createSession(dir, { title: 'Round trip' })
    const read = readSession(dir, created.session.id)
    expect(read).toEqual(created)
  })

  test('returns null for an unknown id', () => {
    expect(readSession(dir, 'does-not-exist')).toBeNull()
  })

  test('returns null for a path-traversal id instead of throwing or escaping the workspace', () => {
    expect(readSession(dir, '../../etc/passwd')).toBeNull()
    expect(readSession(dir, '../outside')).toBeNull()
    expect(readSession(dir, 'a/b')).toBeNull()
  })

  test('rejects structurally corrupt session JSON instead of crashing later', () => {
    const created = createSession(dir)
    const file = join(chatRoot(dir), 'sessions', `${created.session.id}.json`)
    writeFileSync(
      file,
      JSON.stringify({ session: created.session, messages: { not: 'an array' } }),
    )
    expect(readSession(dir, created.session.id)).toBeNull()
  })

  test('rejects a record that redirects its workspace root', () => {
    const created = createSession(dir)
    const file = join(chatRoot(dir), 'sessions', `${created.session.id}.json`)
    writeFileSync(
      file,
      JSON.stringify({
        session: { ...created.session, workspaceRoot: '/tmp/not-this-workspace' },
        messages: [],
      }),
    )
    expect(readSession(dir, created.session.id)).toBeNull()
  })
})

describe('appendMessage', () => {
  test('appends a message and bumps updatedAt', async () => {
    const created = createSession(dir)
    const before = created.session.updatedAt
    await sleep(5)
    const updated = appendMessage(dir, created.session.id, userMessage(created.session.id, 'Explain this function'))
    expect(updated?.messages).toHaveLength(1)
    expect(updated?.session.updatedAt).not.toBe(before)
  })

  test('derives the session title from the first user message', () => {
    const created = createSession(dir)
    const updated = appendMessage(dir, created.session.id, userMessage(created.session.id, 'Fix the race condition in the queue'))
    expect(updated?.session.title).toBe('Fix the race condition in the queue')
  })

  test('does not overwrite an already-derived title on later messages', () => {
    const created = createSession(dir)
    appendMessage(dir, created.session.id, userMessage(created.session.id, 'First message'))
    const second = appendMessage(dir, created.session.id, userMessage(created.session.id, 'Second message'))
    expect(second?.session.title).toBe('First message')
  })

  test('truncates very long first messages for the title', () => {
    const created = createSession(dir)
    const long = 'x'.repeat(200)
    const updated = appendMessage(dir, created.session.id, userMessage(created.session.id, long))
    expect(updated?.session.title.length).toBeLessThanOrEqual(60)
    expect(updated?.session.title.endsWith('…')).toBe(true)
  })

  test('returns null for an unknown session', () => {
    expect(appendMessage(dir, 'nope', userMessage('nope', 'hi'))).toBeNull()
  })

  test('persists messages in order across reads', () => {
    const created = createSession(dir)
    appendMessage(dir, created.session.id, userMessage(created.session.id, 'one'))
    appendMessage(dir, created.session.id, userMessage(created.session.id, 'two'))
    const read = readSession(dir, created.session.id)
    expect(read?.messages.map(m => (m.content[0]?.type === 'text' ? m.content[0].text : ''))).toEqual(['one', 'two'])
  })
})

describe('setCliSessionId', () => {
  test('records the CLI session id for later --resume use', () => {
    const created = createSession(dir)
    expect(created.session.cliSessionId).toBeUndefined()
    const updated = setCliSessionId(dir, created.session.id, 'cli-uuid-123')
    expect(updated?.session.cliSessionId).toBe('cli-uuid-123')
    expect(readSession(dir, created.session.id)?.session.cliSessionId).toBe('cli-uuid-123')
  })
})

describe('archiveSession', () => {
  test('marks a session archived without deleting it', () => {
    const created = createSession(dir)
    expect(archiveSession(dir, created.session.id)).toBe(true)
    const read = readSession(dir, created.session.id)
    expect(read?.session.archived).toBe(true)
  })

  test('returns false for an unknown session', () => {
    expect(archiveSession(dir, 'nope')).toBe(false)
  })
})

describe('deleteSession', () => {
  test('removes the session file and manifest entry', () => {
    const created = createSession(dir)
    expect(deleteSession(dir, created.session.id)).toBe(true)
    expect(readSession(dir, created.session.id)).toBeNull()
    expect(listSessions(dir, { includeArchived: true })).toEqual([])
  })

  test('returns false for an unknown session', () => {
    expect(deleteSession(dir, 'nope')).toBe(false)
  })

  test('rejects a path-traversal id', () => {
    expect(deleteSession(dir, '../evil')).toBe(false)
  })
})

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
