import { describe, expect, test } from 'bun:test'
import { exec } from '../src/utils/Shell.js'

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
})
