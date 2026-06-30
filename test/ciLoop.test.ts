import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HeadlessRunner } from '../src/services/agents/headlessAgent.ts'
import {
  runCiLoop,
  splitCommand,
  summarizeFailure,
  type CommandExec,
} from '../src/services/agents/ciLoop.ts'
import {
  findSimilarFailures,
  formatFailureHints,
} from '../src/services/agents/failureMemory.ts'

test('splitCommand handles quotes and flags', () => {
  expect(splitCommand('bun test')).toEqual({ file: 'bun', args: ['test'] })
  expect(splitCommand('npm run test:ci -- --bail')).toEqual({
    file: 'npm',
    args: ['run', 'test:ci', '--', '--bail'],
  })
})

test('summarizeFailure surfaces error lines', () => {
  const log = ['compiling...', 'ok module a', 'Error: expected 2 to equal 3', 'at foo.ts:10'].join('\n')
  const summary = summarizeFailure(log)
  expect(summary).toContain('Error: expected 2 to equal 3')
})

test('runCiLoop heals: fail -> fix -> fail -> fix -> pass', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-ci-'))
  const codes = [1, 1, 0]
  let runIdx = 0
  let fixes = 0
  const exec: CommandExec = async () => {
    const code = codes[runIdx++] ?? 0
    return { code, stdout: code === 0 ? 'all good' : 'FAIL: boom', stderr: '' }
  }
  const runner: HeadlessRunner = async () => {
    fixes++
    return { output: 'patched', verdict: 'PASS', isError: false }
  }
  const result = await runCiLoop({ cwd: tmp, command: 'bun test', maxAttempts: 3, exec, runner })
  expect(result.status).toBe('passed')
  expect(result.attempts.length).toBe(3)
  expect(runIdx).toBe(3)
  expect(fixes).toBe(2)
  const failures = findSimilarFailures(tmp, 'bun test', 'FAIL: boom')
  expect(failures.some(record => record.attemptedFix?.includes('patched'))).toBe(true)
  expect(
    failures.some(record =>
      record.finalResolution?.includes('Command passed on attempt 3'),
    ),
  ).toBe(true)
  expect(formatFailureHints(failures)).toContain('resolution:')
  rmSync(tmp, { recursive: true, force: true })
})

test('runCiLoop exhausts the retry budget when the fix never lands', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-ci-'))
  const exec: CommandExec = async () => ({ code: 1, stdout: 'still failing', stderr: '' })
  const runner: HeadlessRunner = async () => ({ output: 'tried', verdict: 'FAIL', isError: false })
  const result = await runCiLoop({ cwd: tmp, command: 'bun test', maxAttempts: 2, exec, runner })
  expect(result.status).toBe('exhausted')
  rmSync(tmp, { recursive: true, force: true })
})

test('runCiLoop dry-run does not execute', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-ci-'))
  let ran = false
  const exec: CommandExec = async () => {
    ran = true
    return { code: 0, stdout: '', stderr: '' }
  }
  const result = await runCiLoop({ cwd: tmp, command: 'bun test', dryRun: true, exec })
  expect(ran).toBe(false)
  expect(result.attempts[0].summary).toContain('[dry-run]')
  rmSync(tmp, { recursive: true, force: true })
})
