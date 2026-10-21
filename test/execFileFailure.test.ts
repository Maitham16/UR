import { expect, test } from 'bun:test'
import { execFileNoThrowWithCwd } from '../src/utils/execFileNoThrow.js'

test('early invalid subprocess options resolve an explicit failure without throwing', async () => {
  const result = await execFileNoThrowWithCwd(process.execPath, ['--version'], {
    timeout: -1,
    audit: false,
  })
  expect(result.code).not.toBe(0)
  expect(result.stdout).toBe('')
  expect(result.stderr).toContain('timeout')
})

test('a missing executable resolves failure and never invokes the ownership callback', async () => {
  let launched = false
  const result = await execFileNoThrowWithCwd('ur-missing-executable-fixture', [], {
    stdin: 'ignore',
    audit: false,
    onSpawn: () => { launched = true },
  })
  expect(result.code).not.toBe(0)
  expect(launched).toBe(false)
})
