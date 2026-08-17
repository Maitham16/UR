import { describe, expect, test } from 'bun:test'
import { existsSync, rmSync } from 'node:fs'
import { exec } from '../src/utils/Shell.js'
import { getTaskOutputDir } from '../src/utils/task/diskOutput.js'

async function run(command: string, timeout = 5_000) {
  const controller = new AbortController()
  const shell = await exec(command, controller.signal, 'bash', {
    timeout,
    preventCwdChanges: true,
    shouldUseSandbox: false,
  })
  const result = await shell.result
  shell.cleanup()
  return result
}

describe('production Shell execution', () => {
  test('preserves stdout and stderr as separate streams', async () => {
    const result = await run("printf 'out'; printf 'err' >&2")
    expect(result.stdout).toBe('out')
    expect(result.stderr).toBe('err')
    expect(result.code).toBe(0)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  test('preserves Unicode, quotes, multiline commands and failure codes', async () => {
    const result = await run("printf '%s\\n' 'héllo — 世界'\nprintf '%s' 'bad \"quote\"' >&2\nexit 42")
    expect(result.stdout).toBe('héllo — 世界\n')
    expect(result.stderr).toBe('bad "quote"')
    expect(result.code).toBe(42)
  })

  test('a timeout waits for terminal process evidence and reports its cause', async () => {
    const result = await run('sleep 5', 40)
    expect(result.timedOut).toBe(true)
    expect(result.signal).toBeDefined()
    expect(result.code).toBeGreaterThanOrEqual(128)
    expect(result.stderr).toContain('timed out')
  })

  test('recreates a reclaimed task output directory without restarting', async () => {
    const first = await run("printf 'first'")
    expect(first.stdout).toBe('first')

    const taskOutputDir = getTaskOutputDir()
    expect(existsSync(taskOutputDir)).toBe(true)
    rmSync(taskOutputDir, { recursive: true, force: true })
    // The full suite runs shell tests concurrently, so another command may
    // recreate this shared session directory immediately after rmSync returns.
    // The recovery assertion below is the behavior this regression protects.

    const recovered = await run("printf 'recovered'")
    expect(recovered.stdout).toBe('recovered')
    expect(recovered.stderr).toBe('')
    expect(recovered.code).toBe(0)
    expect(existsSync(taskOutputDir)).toBe(true)
  })
})
