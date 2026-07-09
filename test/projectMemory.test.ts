import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendProjectMemory,
  readProjectMemoryByKind,
  compressProjectMemory,
  getProjectMemorySummary,
  TASK_MEMORY_KINDS,
  taskMemoryPath,
  compressedContextPath,
} from '../src/services/context/projectContextManifest.js'

describe('persistent project memory', () => {
  let cwd: string

  it('TASK_MEMORY_KINDS includes the new categories', () => {
    for (const kind of ['architecture', 'preference', 'attempt', 'accepted', 'rejected']) {
      expect(TASK_MEMORY_KINDS as readonly string[]).toContain(kind)
    }
  })

  it('appendProjectMemory writes JSONL with metadata', () => {
    cwd = mkdtempSync(join(tmpdir(), 'ur-memory-'))
    const entry = appendProjectMemory(
      cwd,
      'architecture',
      'Use repository pattern for data access',
      {
        status: 'accepted',
        rationale: 'Simplifies testing and mocking',
        scope: 'project',
        source: 'team decision',
      },
    )
    expect(entry.kind).toBe('architecture')
    expect(entry.text).toBe('Use repository pattern for data access')
    expect(entry.status).toBe('accepted')
    expect(entry.rationale).toBe('Simplifies testing and mocking')
    expect(entry.scope).toBe('project')
    expect(entry.source).toBe('team decision')

    const raw = readFileSync(taskMemoryPath(cwd), 'utf8').trim()
    const parsed = JSON.parse(raw)
    expect(parsed.kind).toBe('architecture')
    expect(parsed.status).toBe('accepted')
    rmSync(cwd, { recursive: true, force: true })
  })

  it('readProjectMemoryByKind filters by requested kinds', () => {
    cwd = mkdtempSync(join(tmpdir(), 'ur-memory-'))
    appendProjectMemory(cwd, 'accepted', 'Pattern A')
    appendProjectMemory(cwd, 'rejected', 'Pattern B')
    appendProjectMemory(cwd, 'architecture', 'Pattern C')
    const found = readProjectMemoryByKind(cwd, ['accepted', 'rejected'])
    expect(found.map(e => e.kind).sort()).toEqual(['accepted', 'rejected'])
    rmSync(cwd, { recursive: true, force: true })
  })

  it('compressProjectMemory includes new sections', () => {
    cwd = mkdtempSync(join(tmpdir(), 'ur-memory-'))
    appendProjectMemory(cwd, 'architecture', 'Use clean architecture')
    appendProjectMemory(cwd, 'preference', 'Use bun test')
    appendProjectMemory(cwd, 'attempt', 'Try pnpm')
    appendProjectMemory(cwd, 'accepted', 'Use p-map')
    appendProjectMemory(cwd, 'rejected', 'Switch to esbuild')
    const body = compressProjectMemory(cwd)
    for (const heading of ['## Architectures', '## Preferences', '## Attempts', '## Accepteds', '## Rejecteds']) {
      expect(body).toContain(heading)
    }
    expect(body).toContain('Use clean architecture')
    expect(body).toContain('Use bun test')
    rmSync(cwd, { recursive: true, force: true })
  })

  it('getProjectMemorySummary returns a markdown summary', () => {
    cwd = mkdtempSync(join(tmpdir(), 'ur-memory-'))
    appendProjectMemory(cwd, 'accepted', 'Accepted pattern')
    appendProjectMemory(cwd, 'rejected', 'Rejected pattern')
    const summary = getProjectMemorySummary(cwd)
    expect(summary).toContain('# Project Memory Summary')
    expect(summary).toContain('## Accepteds')
    expect(summary).toContain('## Rejecteds')
    expect(summary).toContain('Accepted pattern')
    expect(summary).toContain('Rejected pattern')
    rmSync(cwd, { recursive: true, force: true })
  })
})
