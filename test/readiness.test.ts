import { afterEach, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectReadiness, formatReadiness } from '../src/services/readiness.js'
import { createGoal, mutateGoal } from '../src/services/agents/goals.js'
import { createSpec } from '../src/services/agents/spec.js'
import { saveVerificationRecord } from '../src/services/agents/specVerifier.js'
import { FirstTaskGuide } from '../src/components/FirstTaskGuide.js'
import { renderToString } from '../src/utils/staticRender.js'
import * as React from 'react'
import { captureVerificationState } from '../src/services/verifier/executionEvidence.js'

const dirs: string[] = []
function project() {
  const cwd = mkdtempSync(join(tmpdir(), 'ur-readiness-')); dirs.push(cwd)
  execFileSync('git', ['init', '-q', cwd])
  writeFileSync(join(cwd, 'input.ts'), 'export const answer = 42\n')
  return cwd
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const settings = { provider: { active: 'openai-compatible', model: 'fixture',
  baseUrls: { 'openai-compatible': 'https://fixture.invalid/v1' } } } as const
const adapters = { env: {}, getApiKey: () => undefined,
  fetch: async () => new Response(JSON.stringify({ data: [{ id: 'fixture' }] }), { status: 200 }) }

test('fresh readiness checks the selected provider without requesting generation or requiring Ollama', async () => {
  const cwd = project()
  const requests: string[] = []
  const report = await collectReadiness(cwd, { settings, providerAdapters: { ...adapters,
    fetch: async input => { requests.push(String(input)); return adapters.fetch() } } })
  expect(report.provider.id).toBe('openai-compatible')
  expect(report.provider.model).toBe('fixture')
  expect(report.provider.generationVerified).toBe(false)
  expect(requests.every(url => !url.includes('ollama') && !url.includes('chat/completions'))).toBe(true)
  expect(existsSync(join(cwd, '.ur'))).toBe(false)
  expect(report.workflow.firstTask).toContain('--max-turns 3')
  expect(formatReadiness(report)).toContain('generation not tested')
  expect(JSON.parse(formatReadiness(report, true)).scope).toBe('diagnostics-only')
})

test('missing API credentials gives the real picker path without exposing credentials or raw endpoints', async () => {
  const cwd = project()
  const report = await collectReadiness(cwd, {
    settings: { provider: { active: 'nvidia-nim', model: 'fixture' } },
    providerAdapters: { ...adapters, env: {}, getApiKey: () => undefined },
  })
  expect(report.ready).toBe(false)
  expect(report.provider.next).toContain('/model')
  expect(report.provider.next).toContain('(K)')
  expect(report.provider.doctor).toBe('ur provider doctor nvidia-nim')
  expect(report.provider.checks.some(check => check.status === 'fail')).toBe(true)
  expect(JSON.stringify(report)).not.toContain('baseUrl')
})

test('review reports legacy proof honestly without migrating or rewriting it, and separates unknown costs', async () => {
  const cwd = project()
  createSpec(cwd, 'demo', 'Verify the answer')
  saveVerificationRecord(cwd, 'demo', { version: 1, verdict: 'PASS', summary: 'old proof', commandFailures: 0, generatedAt: new Date().toISOString() })
  const path = join(cwd, '.ur/specs/demo/verification.json'), original = readFileSync(path, 'utf8')
  createGoal(cwd, 'work', 'Implement the task')
  mutateGoal(cwd, 'work', goal => {
    goal.controller!.state = 'interrupted'
    goal.controller!.usage = { calls: 2, turns: 0, costUsd: 0.1, unknownCostCalls: 1, unknownTurnCalls: 2, elapsedMs: 100 }
  })
  const report = await collectReadiness(cwd, { settings, providerAdapters: adapters })
  expect(report.workspace.verification[0]).toMatchObject({ name: 'demo', verdict: 'PARTIAL', freshness: 'unverifiable' })
  expect(readFileSync(path, 'utf8')).toBe(original)
  expect(report.workspace.goals[0]).toMatchObject({ controller: 'interrupted', outcome: 'unverified', costUsd: 0.1, unknownCostCalls: 1 })
  expect(report.workspace.goals[0]!.resume).toBe('ur goal resume "work"')
  expect(formatReadiness(report)).toContain('$0.1000 + 1 unknown-cost calls')
})

test('readiness does not reclaim saved background ownership or execute project hooks', async () => {
  const cwd = project()
  const marker = join(cwd, 'should-not-run')
  mkdirSync(join(cwd, '.ur/background'), { recursive: true })
  const path = join(cwd, '.ur/background/tasks.json')
  // A valid orphaned task would be reconciled to failed by listBackgroundTasks.
  writeFileSync(path, JSON.stringify({ version: 1, tasks: [{ id: 'old', task: 'unfinished', status: 'running',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] }))
  const saved = readFileSync(path, 'utf8')
  execFileSync('git', ['-C', cwd, 'config', 'core.fsmonitor', `touch ${marker}`])
  const report = await collectReadiness(cwd, { settings, providerAdapters: adapters })
  expect(report.workspace.background[0]).toMatchObject({ id: 'old', status: 'running' })
  expect(readFileSync(path, 'utf8')).toBe(saved)
  expect(existsSync(marker)).toBe(false)
})

test('historical verified goal is labeled stale after source changes without rewriting goal history', async () => {
  const cwd = project()
  createGoal(cwd, 'checked', 'The source meets its criteria')
  const state = await captureVerificationState(cwd)
  mutateGoal(cwd, 'checked', goal => { goal.status = 'done'; goal.outcome = {
    status: 'verified', at: new Date().toISOString(), summary: 'Historical check', stateSha256: state.sha256 } })
  const before = await collectReadiness(cwd, { settings, providerAdapters: adapters })
  expect(before.workspace.goals[0]!.freshness).toBe('current')
  writeFileSync(join(cwd, 'input.ts'), 'export const answer = 99\n')
  const after = await collectReadiness(cwd, { settings, providerAdapters: adapters })
  expect(after.workspace.goals[0]).toMatchObject({ outcome: 'verified', freshness: 'stale', status: 'done' })
})

test('first-use guidance renders provider setup, bounded first task, cancellation, costs and review', async () => {
  const text = (await renderToString(React.createElement(FirstTaskGuide), 70)).replace(/\s+/gu, ' ')
  for (const expected of ['/model', 'press K', '/ur-doctor', 'Ctrl+C', '/cost', 'ur --resume', 'test evidence']) expect(text).toContain(expected)
  expect(text).not.toContain('dangerously-skip-permissions')
  expect(text).not.toContain('API_KEY=')
})
