import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  appendTaskMemory,
  quarantineInvalidTaskMemory,
  readTaskMemory,
  rollbackTaskMemory,
  TaskMemoryIntegrityError,
  taskMemoryPath,
  verifyTaskMemory,
} from '../src/services/context/projectContextManifest.js'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'ur-memory-integrity-'))
  temporaryDirectories.push(path)
  return path
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true })
  }
})

describe('tamper-evident task memory', () => {
  test('writes private v2 entries with UUIDs, provenance, and a verified hash chain', () => {
    const cwd = temporaryDirectory()
    const first = appendTaskMemory(cwd, 'decision', 'Use deterministic builds', {
      source: 'planning-agent',
      provenance: {
        sourceKind: 'agent',
        actor: 'planner',
        sourceDigest: createHash('sha256').update('plan').digest('hex'),
      },
    })
    const second = appendTaskMemory(cwd, 'accepted', 'Use Bun for release checks', {
      provenance: {
        sourceKind: 'tool',
        sourceRef: 'verify',
        parentIds: [first.id],
      },
    })
    const verification = verifyTaskMemory(cwd)

    expect(first.schemaVersion).toBe(2)
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(first.contentDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(second.previousDigest).toBe(first.contentDigest)
    expect(verification.valid).toBe(true)
    expect(verification.verifiedEntries).toBe(2)
    expect(statSync(taskMemoryPath(cwd)).mode & 0o077).toBe(0)
  })

  test('fails closed on tampering and quarantines only the invalid tail', () => {
    const cwd = temporaryDirectory()
    appendTaskMemory(cwd, 'decision', 'Keep the first entry')
    appendTaskMemory(cwd, 'constraint', 'Original second entry')
    const path = taskMemoryPath(cwd)
    const lines = readFileSync(path, 'utf8').trim().split('\n')
    const tampered = JSON.parse(lines[1]!)
    tampered.text = 'Tampered second entry'
    writeFileSync(path, `${lines[0]}\n${JSON.stringify(tampered)}\n`, { mode: 0o600 })

    const invalid = verifyTaskMemory(cwd)
    expect(invalid.valid).toBe(false)
    expect(invalid.entries).toHaveLength(1)
    expect(invalid.issues[0]?.code).toBe('chain.content_digest')
    expect(() => readTaskMemory(cwd)).toThrow(TaskMemoryIntegrityError)

    const quarantine = quarantineInvalidTaskMemory(cwd)
    expect(quarantine.changed).toBe(true)
    expect(quarantine.retainedEntries).toBe(1)
    expect(quarantine.removedLines).toBe(1)
    expect(readFileSync(quarantine.quarantinePath!, 'utf8')).toContain(
      'Tampered second entry',
    )
    expect(verifyTaskMemory(cwd).valid).toBe(true)
    expect(readTaskMemory(cwd)).toHaveLength(1)
  })

  test('rolls back atomically while preserving the removed history in a backup', () => {
    const cwd = temporaryDirectory()
    appendTaskMemory(cwd, 'decision', 'one')
    const second = appendTaskMemory(cwd, 'decision', 'two')
    appendTaskMemory(cwd, 'decision', 'three')

    const rollback = rollbackTaskMemory(cwd, second.id)
    expect(rollback.retainedEntries).toBe(2)
    expect(rollback.removedEntries).toBe(1)
    expect(readTaskMemory(cwd).map(entry => entry.text)).toEqual(['one', 'two'])
    expect(readFileSync(rollback.backupPath, 'utf8')).toContain('three')
    expect(verifyTaskMemory(cwd).valid).toBe(true)
  })

  test('anchors a legacy JSONL prefix when the first v2 entry is appended', () => {
    const cwd = temporaryDirectory()
    const path = taskMemoryPath(cwd)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(
      path,
      `${JSON.stringify({
        id: 'legacy-1',
        at: '2026-01-01T00:00:00.000Z',
        kind: 'note',
        text: 'Legacy memory',
      })}\n`,
    )
    appendTaskMemory(cwd, 'note', 'First protected memory')

    const verification = verifyTaskMemory(cwd)
    expect(verification.valid).toBe(true)
    expect(verification.legacyEntries).toBe(1)
    expect(verification.verifiedEntries).toBe(1)
    expect(verification.issues[0]?.code).toBe('chain.legacy_prefix')
  })

  test('refuses a symlinked task-memory destination', () => {
    const cwd = temporaryDirectory()
    const outside = join(cwd, 'outside.jsonl')
    writeFileSync(outside, 'do-not-touch\n')
    mkdirSync(dirname(taskMemoryPath(cwd)), { recursive: true })
    symlinkSync(outside, taskMemoryPath(cwd))

    expect(() => appendTaskMemory(cwd, 'note', 'unsafe')).toThrow('symlink')
    expect(readFileSync(outside, 'utf8')).toBe('do-not-touch\n')
  })
})
