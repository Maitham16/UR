import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HeadlessRunner } from '../src/services/agents/headlessAgent.ts'
import {
  approvePhase,
  createSpec,
  loadSpec,
  markTaskDone,
  parseTasks,
  readPhase,
  runSpec,
} from '../src/services/agents/spec.ts'

test('createSpec scaffolds the three phase docs and meta', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-spec-'))
  const meta = createSpec(tmp, 'Cool Feature', 'Add a parser\nAdd tests\nAdd docs')
  expect(meta.name).toBe('cool-feature')
  expect(meta.phase).toBe('requirements')
  expect(existsSync(join(tmp, '.ur', 'specs', 'cool-feature', 'requirements.md'))).toBe(true)
  expect(existsSync(join(tmp, '.ur', 'specs', 'cool-feature', 'design.md'))).toBe(true)
  expect(existsSync(join(tmp, '.ur', 'specs', 'cool-feature', 'tasks.md'))).toBe(true)
  rmSync(tmp, { recursive: true, force: true })
})

test('parseTasks reads Spec Kit-style checkboxes and markTaskDone checks one off', () => {
  const md = ['# Tasks', '', '- [ ] T1: first', '- [x] T2: second', '- [ ] T3: third'].join('\n')
  const tasks = parseTasks(md)
  expect(tasks.length).toBe(3)
  expect(tasks[0]).toEqual({ id: 'T1', title: 'first', done: false })
  expect(tasks[1].done).toBe(true)
  const updated = markTaskDone(md, 'T1')
  expect(parseTasks(updated)[0].done).toBe(true)
})

test('approvePhase advances the phase and records approval', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-spec-'))
  createSpec(tmp, 'feat', 'do a thing')
  const meta = approvePhase(tmp, 'feat', 'requirements')
  expect(meta?.approvals.requirements).toBe(true)
  expect(meta?.phase).toBe('design')
  rmSync(tmp, { recursive: true, force: true })
})

test('runSpec executes open tasks and marks them done on PASS', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-spec-'))
  createSpec(tmp, 'feat', '1. build the core 2. add the tests 3. write the docs')
  const runner: HeadlessRunner = async () => ({ output: 'done', verdict: 'PASS', isError: false })
  const result = await runSpec(tmp, 'feat', { cwd: tmp, all: true, runner })
  expect(result.remaining).toBe(0)
  expect(result.ran.every(r => r.status === 'done')).toBe(true)
  expect(parseTasks(readPhase(tmp, 'feat', 'tasks') ?? '').every(t => t.done)).toBe(true)
  rmSync(tmp, { recursive: true, force: true })
})

test('runSpec stops on the first failing task', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-spec-'))
  createSpec(tmp, 'feat', '1. step one 2. step two 3. step three')
  let n = 0
  const runner: HeadlessRunner = async () => {
    n++
    return n === 2
      ? { output: 'broke', verdict: 'FAIL', isError: false }
      : { output: 'ok', verdict: 'PASS', isError: false }
  }
  const result = await runSpec(tmp, 'feat', { cwd: tmp, all: true, runner })
  expect(result.stoppedOnFailure).toBe(true)
  expect(result.remaining).toBeGreaterThan(0)
  expect(loadSpec(tmp, 'feat')?.name).toBe('feat')
  rmSync(tmp, { recursive: true, force: true })
})
