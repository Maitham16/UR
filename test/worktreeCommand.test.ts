import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { call } from '../src/commands/worktree/worktree.js'

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('ur worktree command', () => {
  test('call returns usage for unknown action', async () => {
    const dir = tempDir('ur-worktree-')
    try {
      const result = await call('unknown', {} as never)
      expect(result.type).toBe('text')
      if (result.type === 'text') {
        expect(result.value).toContain('Usage:')
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('list returns no active worktrees in empty dir', async () => {
    const dir = tempDir('ur-worktree-')
    try {
      const result = await call('list', {} as never)
      expect(result.type).toBe('text')
      if (result.type === 'text') {
        expect(result.value).toContain('No active agent worktrees')
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('clean reports nothing to clean when no tasks exist', async () => {
    const dir = tempDir('ur-worktree-')
    try {
      const result = await call('clean --dry-run', {} as never)
      expect(result.type).toBe('text')
      if (result.type === 'text') {
        expect(result.value).toContain('No completed/failed/canceled worktrees')
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
