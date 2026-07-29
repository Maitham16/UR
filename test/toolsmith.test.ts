import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { call } from '../src/commands/toolsmith/toolsmith.js'
import { runWithCwdOverride } from '../src/utils/cwd.js'

describe('/toolsmith path safety', () => {
  test('creates a validated helper inside .ur/tools', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ur-toolsmith-'))
    try {
      const result = await runWithCwdOverride(cwd, () =>
        call('csv-differ node', {} as never),
      )
      expect(result.type).toBe('text')
      const path = join(cwd, '.ur', 'tools', 'csv-differ.js')
      expect(existsSync(path)).toBe(true)
      expect(readFileSync(path, 'utf8')).toContain('#!/usr/bin/env node')
    } finally {
      rmSync(cwd, {recursive: true, force: true})
    }
  })

  test('rejects traversal instead of writing outside the tool directory', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ur-toolsmith-traversal-'))
    try {
      const result = await runWithCwdOverride(cwd, () =>
        call('../../escaped node', {} as never),
      )
      expect(result.type).toBe('text')
      if (result.type === 'text') expect(result.value).toContain('paths are not allowed')
      expect(existsSync(join(cwd, 'escaped.js'))).toBe(false)
    } finally {
      rmSync(cwd, {recursive: true, force: true})
    }
  })
})
