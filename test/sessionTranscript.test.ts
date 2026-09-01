import { afterEach, describe, expect, test } from 'bun:test'
import { getAutoMemPath } from '../src/memdir/paths.js'
import type { Message } from '../src/types/message.js'
import {
  flushSessionTranscriptWrites,
  reduceTranscriptMessages,
  setSessionTranscriptIOForTests,
  transcriptEntryMarker,
  writeSessionTranscriptSegment,
} from '../src/services/sessionTranscript/sessionTranscript.js'

const originalMemoryOverride = process.env.UR_COWORK_MEMORY_PATH_OVERRIDE

function user(uuid: string, text: string, timestamp: string): Message {
  return {
    type: 'user',
    uuid,
    timestamp,
    origin: { kind: 'human' },
    message: { content: text },
  }
}

function assistant(uuid: string, text: string, timestamp: string): Message {
  return {
    type: 'assistant',
    uuid,
    timestamp,
    message: { content: [{ type: 'text', text }] },
  }
}

afterEach(async () => {
  await flushSessionTranscriptWrites()
  setSessionTranscriptIOForTests()
  if (originalMemoryOverride === undefined)
    delete process.env.UR_COWORK_MEMORY_PATH_OVERRIDE
  else process.env.UR_COWORK_MEMORY_PATH_OVERRIDE = originalMemoryOverride
  getAutoMemPath.cache.clear()
})

describe('reduced KAIROS session transcript', () => {
  test('excludes compact summaries and generated/meta user forms', () => {
    const timestamp = '2026-04-10T08:00:00.000Z'
    const entries = reduceTranscriptMessages([
      user('human', 'keep me', timestamp),
      { ...user('compact', 'summary', timestamp), isCompactSummary: true },
      { ...user('meta', 'nudge', timestamp), isMeta: true },
      { ...user('virtual', 'synthetic', timestamp), isVirtual: true },
      {
        ...user('channel', 'channel push', timestamp),
        origin: { kind: 'channel' },
      },
      user(
        'reminder',
        '<system-reminder>internal system context</system-reminder>',
        timestamp,
      ),
      user('tick', '<tick>08:00:00</tick>', timestamp),
      user(
        'mixed',
        'visible request\n<system-reminder>hidden context</system-reminder>',
        timestamp,
      ),
      assistant('reply', 'kept reply', timestamp),
    ])
    expect(entries.map(entry => entry.text)).toEqual([
      'keep me',
      'visible request',
      'kept reply',
    ])
  })

  test('deduplicates repeated and overlapping compaction batches per entry', async () => {
    process.env.UR_COWORK_MEMORY_PATH_OVERRIDE = '/tmp/ur-transcript-memory'
    getAutoMemPath.cache.clear()
    const files = new Map<string, string>()
    setSessionTranscriptIOForTests({
      async read(path) {
        const value = files.get(path)
        if (value !== undefined) return value
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      },
      async mkdir() {},
      async append(path, content) {
        files.set(path, (files.get(path) ?? '') + content)
      },
    })

    const timestamp = '2026-04-10T08:00:00.000Z'
    const first = user('u-1', 'first user message', timestamp)
    const reply = assistant('a-1', 'first assistant reply', timestamp)
    const later = user('u-2', 'overlapping later message', timestamp)
    await writeSessionTranscriptSegment([first, reply])
    await writeSessionTranscriptSegment([first, reply])
    await writeSessionTranscriptSegment([reply, later])
    await flushSessionTranscriptWrites()

    const content = [...files.values()].join('\n')
    for (const text of [
      'first user message',
      'first assistant reply',
      'overlapping later message',
    ]) {
      expect(content.split(text).length - 1).toBe(1)
    }
    const entries = reduceTranscriptMessages([first, reply, later])
    for (const entry of entries) {
      expect(content.split(transcriptEntryMarker(entry)).length - 1).toBe(1)
      expect(content.indexOf(entry.text)).toBeLessThan(
        content.indexOf(transcriptEntryMarker(entry)),
      )
    }
  })

  test('heals the process-local queue and retries after append failure', async () => {
    process.env.UR_COWORK_MEMORY_PATH_OVERRIDE = '/tmp/ur-transcript-retry'
    getAutoMemPath.cache.clear()
    let attempts = 0
    let persisted = ''
    setSessionTranscriptIOForTests({
      async read() {
        if (persisted) return persisted
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      },
      async mkdir() {},
      async append(_path, content) {
        attempts++
        if (attempts === 1) throw new Error('simulated append failure')
        persisted += content
      },
    })
    const message = user(
      'retry-user',
      'must survive a failed append',
      '2026-04-10T08:00:00.000Z',
    )

    await writeSessionTranscriptSegment([message])
    await writeSessionTranscriptSegment([message])
    await flushSessionTranscriptWrites()

    expect(attempts).toBe(2)
    expect(persisted).toContain('must survive a failed append')
    const [entry] = reduceTranscriptMessages([message])
    expect(persisted).toContain(transcriptEntryMarker(entry!))
  })
})
