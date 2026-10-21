import { afterEach, describe, expect, test } from 'bun:test'
import { appendFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGoal, loadGoal, setGoalStatus } from '../src/services/agents/goals.js'
import { assessGoalOutcome, runGoalController } from '../src/services/agents/goalController.js'
import { saveWorkflow } from '../src/services/agents/workflows.js'
import type { HeadlessRunOptions, HeadlessRunOutput, HeadlessRunner } from '../src/services/agents/headlessAgent.js'
import { getEmptyToolPermissionContext } from '../src/Tool.js'
import { captureVerificationState, type VerificationEvidence } from '../src/services/verifier/executionEvidence.js'

const roots: string[] = []
const children: ReturnType<typeof Bun.spawn>[] = []
afterEach(async () => { for (const child of children.splice(0)) { try { child.kill('SIGKILL') } catch {} await child.exited } for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }) })
function temp(): string { const cwd = mkdtempSync(join(tmpdir(), 'ur-goal-')); roots.push(cwd); return cwd }
function update(action: string, extra = {}): HeadlessRunOutput {
  return { output: `<ur-goal-update>${JSON.stringify({ action, summary: 'Actual progress', ...extra })}</ur-goal-update>`, costUsd: 0.1, turns: 1 }
}
function verification(passed: boolean, extra = {}): HeadlessRunOutput {
  return { output: `<ur-goal-verification>${JSON.stringify({ summary: 'Criteria checked', criteria: [{ id: 'c1', passed, reason: 'Inspected the current deliverable', ...extra }] })}</ur-goal-verification>`, costUsd: 0.2, turns: 2, verdict: passed ? 'PASS' : 'FAIL' }
}
async function until(predicate: () => boolean): Promise<void> { const end = Date.now() + 10000; while (!predicate()) { if (Date.now() > end) throw new Error('fixture did not become ready'); await Bun.sleep(20) } }

describe('persistent model-directed goal controller', () => {
  test('a goal without a workflow advances and is completed only by separate criterion evidence', async () => {
    const cwd = temp(); createGoal(cwd, 'docs', 'Document the license', { criteria: ['README explains the license'], budget: { maxCalls: 4, maxTurns: 10, maxCostUsd: 2 } })
    const requests: HeadlessRunOptions[] = []
    const result = await runGoalController('docs', { cwd, runner: async options => {
      requests.push(options)
      if (!options.verification) { writeFileSync(join(cwd, 'README.md'), 'License: noncommercial use only.\n'); return update('verify') }
      return verification(true, { artifacts: [{ path: 'README.md', excerpt: 'License: noncommercial use only.' }] })
    } })
    expect(result.status).toBe('done')
    expect(result.outcome?.status).toBe('verified')
    expect(result.outcome?.criteria?.[0].artifacts[0].sha256).toHaveLength(64)
    expect(result.controller?.usage.calls).toBe(2)
    expect(result.controller?.usage.turns).toBe(3)
    expect(result.controller?.usage.costUsd).toBeCloseTo(0.3)
    expect(requests[0].maxBudgetUsd).toBe(2)
    expect(requests[1].maxBudgetUsd).toBeCloseTo(1.9)
    expect(requests[1].maxTurns).toBe(9)
    expect(requests[1].verification?.runId).toBeDefined()
  })

  test('a completed workflow is progress, not outcome verification; failures return to the model for replanning', async () => {
    const cwd = temp(); createGoal(cwd, 'ship', 'Publish a correct document', { workflow: 'draft', budget: { maxCalls: 8 } })
    saveWorkflow(cwd, { version: 1, name: 'draft', steps: [{ id: 'write', name: 'write', agent: 'worker', prompt: 'write a document' }] })
    let stage = 0
    const result = await runGoalController('ship', { cwd, runner: async options => {
      stage++
      if (stage === 1) return update('workflow', { workflow: 'draft' })
      if (stage === 2) return { output: 'Workflow complete\nVERDICT: PASS', verdict: 'PASS', costUsd: 0.1, turns: 1 }
      if (stage === 3) { expect(options.prompt).toContain('Completion is not outcome verification'); return update('verify') }
      if (options.verification) return verification(true, { executions: ['fabricated'] })
      expect(options.prompt).toContain('Outcome remains unverified')
      return update('blocked', { blockers: ['Need the correct publication destination from the owner.'] })
    } })
    expect(stage).toBe(5)
    expect(result.status).toBe('active')
    expect(result.outcome?.status).toBe('unverified')
    expect(result.controller?.state).toBe('blocked')
    expect(result.controller?.blockers).toEqual(['Need the correct publication destination from the owner.'])
  })

  test('aggregate budgets and history survive restart; increasing the explicit call budget does not reset usage', async () => {
    const cwd = temp(); createGoal(cwd, 'budget', 'keep working', { budget: { maxCalls: 2 } })
    const first = await runGoalController('budget', { cwd, runner: async () => update('continue', { nextPrompt: 'choose the next useful step' }) })
    expect(first.controller?.state).toBe('budget-exhausted')
    expect(first.controller?.usage.calls).toBe(2)
    expect(first.controller?.history).toHaveLength(2)
    const second = await runGoalController('budget', { cwd, budget: { maxCalls: 3 }, runner: async options => {
      expect(options.prompt).toContain('choose the next useful step')
      return update('blocked', { blockers: ['Need credentials; no request was made.'] })
    } })
    expect(second.controller?.usage.calls).toBe(3)
    expect(second.controller?.history).toHaveLength(3)
    expect(second.controller?.blockers[0]).toContain('Need credentials')
  })

  test('unknown monetary usage is explicit instead of being counted as zero', async () => {
    const cwd = temp(); createGoal(cwd, 'cost', 'work', { budget: { maxCostUsd: 1, maxCalls: 10 } })
    let calls = 0
    const result = await runGoalController('cost', { cwd, runner: async () => { calls++; return { output: update('continue').output, turns: 1 } } })
    expect(calls).toBe(1)
    expect(result.controller?.usage.unknownCostCalls).toBe(1)
    expect(result.controller?.state).toBe('budget-exhausted')
    expect(result.controller?.blockers[0]).toContain('unknown cost')
  })

  test('dry run leaves completion and budget state unchanged; explicit user done is labeled manual', async () => {
    const cwd = temp(); createGoal(cwd, 'preview', 'verify later')
    const before = readFileSync(join(cwd, '.ur/goals/preview.json'), 'utf8')
    await runGoalController('preview', { cwd, dryRun: true, runner: async () => { throw new Error('must not run') } })
    expect(readFileSync(join(cwd, '.ur/goals/preview.json'), 'utf8')).toBe(before)
    const manual = setGoalStatus(cwd, 'preview', 'done')!
    expect(manual.outcome?.status).toBe('manual')
    expect(manual.outcome?.summary).toContain('explicitly by the user')
  })

  test('real killed controller persists its session and effects, then resumes with unknown-outcome context', async () => {
    const cwd = temp(); createGoal(cwd, 'restart', 'inspect and finish', { budget: { maxCalls: 4 } })
    const moduleUrl = new URL('../src/services/agents/goalController.ts', import.meta.url).href
    const child = Bun.spawn([process.execPath, '-e', `
      import {writeFileSync,appendFileSync} from 'node:fs';
      import {runGoalController} from ${JSON.stringify(moduleUrl)};
      await runGoalController('restart',{cwd:${JSON.stringify(cwd)},runner:async options=>{
        appendFileSync(${JSON.stringify(join(cwd, 'effect'))},'once\\n');
        writeFileSync(${JSON.stringify(join(cwd, 'ready'))},options.sessionId);
        setInterval(()=>{},1000);await new Promise(()=>{});
      }});
    `], { env: process.env, stdout: 'pipe', stderr: 'pipe' })
    children.push(child)
    await until(() => existsSync(join(cwd, 'ready')))
    await expect(runGoalController('restart', { cwd, runner: async () => update('blocked') })).rejects.toThrow('live controller')
    const sessionId = readFileSync(join(cwd, 'ready'), 'utf8')
    child.kill('SIGKILL'); await child.exited
    const result = await runGoalController('restart', { cwd, runner: async options => {
      expect(options.resumeSessionId).toBe(sessionId)
      expect(options.prompt).toContain('tool effects and incomplete usage are UNKNOWN')
      return update('blocked', { blockers: ['Inspected the existing effect; need an owner decision.'] })
    } })
    expect(result.controller?.usage.calls).toBe(2)
    expect(result.controller?.usage.unknownCostCalls).toBe(1)
    expect(readFileSync(join(cwd, 'effect'), 'utf8')).toBe('once\n')
  })

  test('pause cancels an active runner and preserves resumable session state', async () => {
    const cwd = temp(); createGoal(cwd, 'pause', 'long task')
    let started = false
    const running = runGoalController('pause', { cwd, runner: async options => {
      started = true
      await new Promise<void>(resolve => { options.signal!.addEventListener('abort', () => resolve(), { once: true }) })
      return { output: 'Canceled after partial work', isError: true, costUsd: 0.1, turns: 1 }
    } })
    await until(() => started)
    setGoalStatus(cwd, 'pause', 'paused')
    const result = await running
    expect(result.status).toBe('paused')
    expect(result.controller?.state).toBe('interrupted')
    expect(result.controller?.inFlight?.sessionId).toBeDefined()
    expect(result.controller?.owner).toBeUndefined()
  })
})

test('criterion evidence rejects fabricated/stale/failed command receipts and changed excerpts', async () => {
  const cwd = temp(); writeFileSync(join(cwd, 'report.md'), 'actual observed content')
  const goal = createGoal(cwd, 'evidence', 'correct report')
  const state = await captureVerificationState(cwd)
  const evidence: VerificationEvidence = { version: 1, runId: 'nonce', cwd: state.root, stateSha256: state.sha256, executions: [{
    version: 1, id: 'actual', toolUseId: 'actual', runId: 'nonce', cwd: state.root, command: 'test -f report.md', exitCode: 0,
    startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), interrupted: false, stdout: '', stderr: '', changedFiles: [], beforeStateSha256: state.sha256, afterStateSha256: state.sha256,
  }] }
  expect((await assessGoalOutcome(goal, cwd, verification(true, { executions: ['actual'] }).output, evidence, false)).status).toBe('verified')
  for (const receipt of [[], [{ ...evidence.executions[0], exitCode: 1 }], [{ ...evidence.executions[0], runId: 'wrong' }], [{ ...evidence.executions[0], beforeStateSha256: 'stale' }]]) {
    expect((await assessGoalOutcome(goal, cwd, verification(true, { executions: ['actual'] }).output, { ...evidence, executions: receipt }, false)).status).toBe('unverified')
  }
  expect((await assessGoalOutcome(goal, cwd, verification(true, { artifacts: [{ path: 'report.md', excerpt: 'invented content' }] }).output, evidence, false)).status).toBe('unverified')
  expect((await assessGoalOutcome(goal, cwd, verification(true, { artifacts: [{ path: '../outside', excerpt: 'x' }] }).output, evidence, false)).status).toBe('unverified')
  expect((await assessGoalOutcome(goal, cwd, verification(true, { executions: ['actual'] }).output, evidence, true)).status).toBe('unverified')
})

test('controller artifact receipts cannot bypass private, ignored, symlink or explicit Read boundaries', async () => {
  const cwd = temp(), outside = temp()
  writeFileSync(join(cwd, 'report.md'), 'public report content')
  writeFileSync(join(cwd, '.env'), 'PRIVATE_VALUE=do-not-observe')
  writeFileSync(join(cwd, '.gitignore'), 'ignored.txt\n.ur/\n')
  writeFileSync(join(cwd, 'ignored.txt'), 'ignored private content')
  writeFileSync(join(outside, 'private.txt'), 'outside content')
  symlinkSync(join(outside, 'private.txt'), join(cwd, 'linked.txt'))
  const initialized = Bun.spawnSync(['git', 'init', '-q', cwd])
  expect(initialized.exitCode).toBe(0)
  const goal = createGoal(cwd, 'private', 'inspect public sources')
  const state = await captureVerificationState(cwd)
  const evidence: VerificationEvidence = { version: 1, runId: 'nonce', cwd: state.root, stateSha256: state.sha256, executions: [] }
  for (const artifact of [{ path: '.env', excerpt: 'PRIVATE_VALUE=do-not-observe' }, { path: 'ignored.txt', excerpt: 'ignored private content' }, { path: 'linked.txt', excerpt: 'outside content' }]) {
    const result = await assessGoalOutcome(goal, cwd, verification(true, { artifacts: [artifact] }).output, evidence, false)
    expect(result.status).toBe('unverified')
    expect(result.criteria?.[0].artifacts).toEqual([])
  }
  const report = verification(true, { artifacts: [{ path: 'report.md', excerpt: 'public report content' }] }).output
  for (const behavior of ['deny', 'ask'] as const) {
    const context = { ...getEmptyToolPermissionContext(), [behavior === 'deny' ? 'alwaysDenyRules' : 'alwaysAskRules']: { session: [`Read(/${realpathSync(join(cwd, 'report.md'))})`] } }
    expect((await assessGoalOutcome(goal, cwd, report, evidence, false, context)).status).toBe('unverified')
  }
})

test('useful progress has no default call ceiling; only repeated unchanged work stalls', async () => {
  const cwd = temp(); createGoal(cwd, 'uncapped', 'make continuing useful progress')
  let calls = 0
  const progressed = await runGoalController('uncapped', { cwd, runner: async () => {
    calls++
    if (calls > 21) return update('blocked', { blockers: ['Owner decision after useful work.'] })
    writeFileSync(join(cwd, 'progress.txt'), `completed useful item ${calls}`)
    return update('continue', { summary: 'Continuing useful work' })
  } })
  expect(calls).toBe(22)
  expect(progressed.controller?.budget.maxCalls).toBeUndefined()
  expect(progressed.controller?.usage.calls).toBe(22)
  createGoal(cwd, 'stalled', 'make progress')
  let repeated = 0
  const stalled = await runGoalController('stalled', { cwd, runner: async () => { repeated++; return update('continue', { summary: 'exactly the same claim' }) } })
  expect(repeated).toBe(3)
  expect(stalled.controller?.state).toBe('blocked')
  expect(stalled.controller?.blockers[0]).toContain('no new visible progress')
})
