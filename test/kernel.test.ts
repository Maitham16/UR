import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentKernel, runKernelStage, type KernelStage } from '../src/services/agents/kernel.js'
import { planSpecRun, planSpecVerify, runSpecWithKernel, runSpecVerifyWithKernel } from '../src/services/agents/kernelSpec.js'
import type { HeadlessRunner } from '../src/services/agents/headlessAgent.js'
import { createSpec, parseTasks, readPhase } from '../src/services/agents/spec.js'

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function allProofsOutput(): string {
  return [
    'Compile proof: command `bun run typecheck` exited 0.',
    'Test proof: command `bun test` exited 0.',
    'Lint proof: command `bun run lint` exited 0.',
    'Diff proof: command `git diff --stat` reviewed expected files.',
    'Runtime proof: command `node ./bin/ur.js --version` exited 0.',
    'VERDICT: PASS',
  ].join('\n')
}

describe('AgentKernel', () => {
  test('createAgentKernel returns all seven roles', () => {
    const kernel = createAgentKernel({ cwd: '/tmp' })
    expect(kernel.planner).toBeDefined()
    expect(kernel.executor).toBeDefined()
    expect(kernel.verifier).toBeDefined()
    expect(kernel.critic).toBeDefined()
    expect(kernel.memory).toBeDefined()
    expect(kernel.router).toBeDefined()
    expect(kernel.guard).toBeDefined()
  })

  test('executor stage runs through headless runner and extracts verdict', async () => {
    const dir = tempDir('ur-kernel-exec-')
    const runner: HeadlessRunner = async () => ({ output: 'done\nVERDICT: PASS', verdict: 'PASS', isError: false })
    const kernel = createAgentKernel({ cwd: dir, runner })
    const stage: KernelStage = {
      name: 'exec-1',
      role: 'executor',
      goal: 'implement feature',
      context: { cwd: dir },
      instructions: 'do the thing',
    }
    const result = await runKernelStage(kernel, stage, { cwd: dir, runner })
    expect(result.verdict).toBe('PASS')
    expect(result.output).toContain('done')
    expect(result.isError).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  test('verifier stage fails fast on project gate failure', async () => {
    const dir = tempDir('ur-kernel-verify-')
    createSpec(dir, 'feat', 'do a thing')
    const runner: HeadlessRunner = async () => ({ output: 'VERDICT: PASS', verdict: 'PASS', isError: false })
    const kernel = createAgentKernel({ cwd: dir, runner })
    const stage = planSpecVerify(dir, 'feat')
    // Inject a failing gate by writing verify.json
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(dir, '.ur', 'verify.json'), JSON.stringify({ afterEdit: ['exit 1'] }))
    const result = await runKernelStage(kernel, stage, { cwd: dir, runner })
    expect(result.verdict).toBe('FAIL')
    expect(result.isError).toBe(true)
    expect(result.output).toContain('Project verify gate FAILED')
    rmSync(dir, { recursive: true, force: true })
  })

  test('verifier stage rejects PASS without all required proofs', async () => {
    const dir = tempDir('ur-kernel-proof-')
    createSpec(dir, 'feat', 'do a thing')
    const runner: HeadlessRunner = async () => ({ output: 'VERDICT: PASS', verdict: 'PASS', isError: false })
    const kernel = createAgentKernel({ cwd: dir, runner })
    const result = await runKernelStage(kernel, planSpecVerify(dir, 'feat'), { cwd: dir, runner })
    expect(result.verdict).toBe('FAIL')
    expect(result.isError).toBe(true)
    expect(result.output).toContain('PASS was claimed without required proof')
    rmSync(dir, { recursive: true, force: true })
  })

  test('verifier stage rejects manufactured proof prose without recorded executions', async () => {
    const dir = tempDir('ur-kernel-proof-pass-')
    createSpec(dir, 'feat', 'do a thing')
    const runner: HeadlessRunner = async () => ({ output: allProofsOutput(), verdict: 'PASS', isError: false })
    const kernel = createAgentKernel({ cwd: dir, runner })
    const result = await runKernelStage(kernel, planSpecVerify(dir, 'feat'), { cwd: dir, runner })
    expect(result.verdict).toBe('FAIL')
    expect(result.isError).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test('planner stage returns next stages', async () => {
    const dir = tempDir('ur-kernel-plan-')
    createSpec(dir, 'feat', '1. step one 2. step two')
    const kernel = createAgentKernel({ cwd: dir })
    kernel.planner = {
      planStages: () => planSpecRun(dir, 'feat'),
    }
    const stage: KernelStage = {
      name: 'plan',
      role: 'planner',
      goal: 'plan spec execution',
      context: { cwd: dir, specName: 'feat' },
    }
    const result = await runKernelStage(kernel, stage, { cwd: dir })
    expect(result.verdict).toBeNull()
    expect(result.nextStages?.length).toBeGreaterThan(0)
    rmSync(dir, { recursive: true, force: true })
  })

  test('critic stage reviews previous output', async () => {
    const dir = tempDir('ur-kernel-critic-')
    const runner: HeadlessRunner = async options => ({ output: `critic saw: ${options.prompt.slice(0, 20)}...\nVERDICT: PASS`, verdict: 'PASS', isError: false })
    const kernel = createAgentKernel({ cwd: dir, runner })
    const stage: KernelStage = {
      name: 'work',
      role: 'critic',
      goal: 'review implementation',
      context: { cwd: dir, priorOutputs: { previous: 'implemented x' } },
    }
    const result = await runKernelStage(kernel, stage, { cwd: dir, runner })
    expect(result.verdict).toBe('PASS')
    expect(result.output).toContain('critic saw')
    rmSync(dir, { recursive: true, force: true })
  })

  test('memory stage loads a snippet', async () => {
    const dir = tempDir('ur-kernel-memory-')
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(join(dir, '.ur', 'memory'), { recursive: true })
    writeFileSync(join(dir, '.ur', 'memory', 'worker.md'), 'remember to run tests')
    const kernel = createAgentKernel({ cwd: dir })
    const stage: KernelStage = {
      name: 'worker',
      role: 'memory',
      goal: 'load memory',
      context: { cwd: dir },
    }
    const result = await runKernelStage(kernel, stage, { cwd: dir })
    expect(result.output).toContain('remember to run tests')
    expect(result.artifacts[0].kind).toBe('note')
    rmSync(dir, { recursive: true, force: true })
  })

  test('router stage produces a route note', async () => {
    const dir = tempDir('ur-kernel-router-')
    const kernel = createAgentKernel({ cwd: dir })
    const stage: KernelStage = {
      name: 'route',
      role: 'router',
      goal: 'fix the flaky parser test',
      context: { cwd: dir },
    }
    const result = await runKernelStage(kernel, stage, { cwd: dir })
    expect(result.output).toContain('test-runner')
    expect(result.artifacts[0].kind).toBe('note')
    rmSync(dir, { recursive: true, force: true })
  })

  test('guard allows with skipPermissions and denies otherwise', async () => {
    const dir = tempDir('ur-kernel-guard-')
    const kernelAllowed = createAgentKernel({ cwd: dir, skipPermissions: true })
    const stage: KernelStage = { name: 'Bash', role: 'guard', goal: 'run rm', context: { cwd: dir } }
    const allowed = await runKernelStage(kernelAllowed, stage, { cwd: dir, skipPermissions: true })
    expect(allowed.verdict).toBe('PASS')

    const kernelDenied = createAgentKernel({ cwd: dir, skipPermissions: false })
    const denied = await runKernelStage(kernelDenied, stage, { cwd: dir })
    expect(denied.verdict).toBe('FAIL')
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('kernelSpec adapters', () => {
  test('runSpecWithKernel executes open tasks', async () => {
    const dir = tempDir('ur-kernel-spec-run-')
    createSpec(dir, 'feat', '1. build core 2. add tests')
    const runner: HeadlessRunner = async () => ({ output: 'done\nVERDICT: PASS', verdict: 'PASS', isError: false })
    const kernel = createAgentKernel({ cwd: dir, runner })
    const result = await runSpecWithKernel(dir, 'feat', kernel, { all: true, runner })
    expect(result.ran.length).toBeGreaterThan(0)
    expect(result.stoppedOnFailure).toBe(false)
    expect(parseTasks(readPhase(dir, 'feat', 'tasks') ?? '').every(task => task.done)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test('runSpecWithKernel does not mark PARTIAL tasks done', async () => {
    const dir = tempDir('ur-kernel-spec-partial-')
    createSpec(dir, 'feat', '1. build core 2. add tests')
    const runner: HeadlessRunner = async () => ({ output: 'not enough evidence\nVERDICT: PARTIAL', verdict: 'PARTIAL', isError: false })
    const kernel = createAgentKernel({ cwd: dir, runner })
    const result = await runSpecWithKernel(dir, 'feat', kernel, { all: true, runner })
    expect(result.stoppedOnFailure).toBe(true)
    expect(result.ran[0].status).toBe('failed')
    expect(parseTasks(readPhase(dir, 'feat', 'tasks') ?? '').every(task => !task.done)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test('runSpecVerifyWithKernel returns verifier result', async () => {
    const dir = tempDir('ur-kernel-spec-verify-')
    createSpec(dir, 'feat', 'do a thing')
    const runner: HeadlessRunner = async () => ({ output: 'VERDICT: FAIL\nmissing runtime proof', verdict: 'FAIL', isError: false })
    const kernel = createAgentKernel({ cwd: dir, runner })
    const result = await runSpecVerifyWithKernel(dir, 'feat', kernel, { runner })
    expect(result.verdict).toBe('FAIL')
    expect(result.summary).toContain('failing evidence')
    rmSync(dir, { recursive: true, force: true })
  })
})
