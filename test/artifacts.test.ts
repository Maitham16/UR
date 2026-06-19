import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addFeedback,
  captureTestRun,
  deleteArtifact,
  getArtifact,
  listArtifacts,
  readArtifactBody,
  recordArtifact,
  setStatus,
  type CommandExec,
} from '../src/services/agents/artifacts.ts'

test('recordArtifact writes a body file and a pending manifest entry', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-art-'))
  const artifact = recordArtifact(tmp, { kind: 'plan', title: 'My Plan', body: '# Plan\nstep 1' })
  expect(artifact.id).toBe('1')
  expect(artifact.status).toBe('pending')
  expect(readArtifactBody(tmp, '1')).toContain('step 1')
  expect(listArtifacts(tmp).length).toBe(1)
  rmSync(tmp, { recursive: true, force: true })
})

test('approve/reject and feedback update the artifact', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-art-'))
  recordArtifact(tmp, { kind: 'note', title: 'n', body: 'x' })
  expect(setStatus(tmp, '1', 'approved')?.status).toBe('approved')
  addFeedback(tmp, '1', 'looks good but rename x')
  expect(getArtifact(tmp, '1')?.feedback.length).toBe(1)
  rmSync(tmp, { recursive: true, force: true })
})

test('captureTestRun records pass/fail from the command result', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-art-'))
  const passExec: CommandExec = async () => ({ code: 0, stdout: 'ok', stderr: '' })
  const failExec: CommandExec = async () => ({ code: 1, stdout: '', stderr: 'boom' })
  const passed = await captureTestRun(tmp, 'bun test', passExec)
  const failed = await captureTestRun(tmp, 'bun test', failExec)
  expect(passed.summary).toBe('passed')
  expect(failed.summary).toContain('failed')
  rmSync(tmp, { recursive: true, force: true })
})

test('deleteArtifact removes the entry', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-art-'))
  recordArtifact(tmp, { kind: 'note', title: 'n', body: 'x' })
  expect(deleteArtifact(tmp, '1')).toBe(true)
  expect(listArtifacts(tmp).length).toBe(0)
  rmSync(tmp, { recursive: true, force: true })
})
