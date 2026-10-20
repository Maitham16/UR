import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

describe('optional voice backend recovery', () => {
  function probe(fallback: boolean) {
    const directory = mkdtempSync(join(tmpdir(), 'ur-voice-fallback-'))
    try {
      const bin = join(directory, 'bin')
      mkdirSync(bin)
      if (fallback) {
        const recorder = join(bin, 'rec')
        writeFileSync(recorder, '#!/bin/sh\nexit 0\n')
        chmodSync(recorder, 0o755)
      }
      const source = pathToFileURL(join(import.meta.dir, '../src/services/voice.ts')).href
      const script = `const { checkVoiceDependencies } = await import(${JSON.stringify(source)}); console.log(JSON.stringify(await checkVoiceDependencies()));`
      const result = spawnSync(process.execPath, ['--eval', script], {
        cwd: join(import.meta.dir, '..'),
        encoding: 'utf8',
        timeout: 30_000,
        env: { ...process.env, NODE_ENV: 'test', PATH: bin, UR_CONFIG_DIR: join(directory, 'config') },
      })
      expect(result.status, result.stderr).toBe(0)
      return JSON.parse(result.stdout.trim()) as { available: boolean; missing: string[] }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }

  test.skipIf(process.platform === 'win32')('missing optional addon reaches an available recording fallback', () => {
    const result = probe(true)
    expect(result.available).toBe(true)
    expect(result.missing).toEqual([])
  })

  test('missing optional addon and recorder return unavailable without rejecting', () => {
    const result = probe(false)
    expect(result.available).toBe(false)
    expect(result.missing.length).toBeGreaterThan(0)
  })
})
