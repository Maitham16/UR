/**
 * Kernel adapters for spec-driven development.
 *
 * Converts a UR spec into `KernelStage`s and maps `KernelResult`s back to the
 * existing `SpecRunResult` / `SpecVerifyResult` shapes. This keeps the public
 * spec API stable while allowing `ur spec run|verify --kernel` to use the
 * AgentKernel orchestrator.
 */

import type { AgentKernel, KernelContext, KernelResult, KernelStage } from './kernel.js'
import { runKernelStage } from './kernel.js'
import type { SpecMeta, SpecRunResult, SpecTask } from './spec.js'
import { loadSpec, markTaskDone, parseTasks, readPhase, writePhase } from './spec.js'
import type { SpecVerifyResult } from './specVerifier.js'
import { persistVerificationResult } from './specVerifier.js'
import type { VerificationEvidence } from '../verifier/executionEvidence.js'

export type SpecRunStage = KernelStage & {
  role: 'executor'
  meta: { taskId: string; taskTitle: string }
}

function isSpecRunStage(stage: KernelStage): stage is SpecRunStage {
  return stage.role === 'executor' && 'meta' in stage && typeof (stage as unknown as { meta?: unknown }).meta === 'object'
}

function asSpecRunStage(stage: KernelStage): SpecRunStage | null {
  return isSpecRunStage(stage) ? stage : null
}

function stageSucceeded(result: KernelResult): boolean {
  return result.verdict === 'PASS' && !result.isError
}

export function planSpecRun(cwd: string, name: string): KernelStage[] {
  const spec = loadSpec(cwd, name)
  if (!spec) throw new Error(`Spec not found: ${name}`)
  const requirements = readPhase(cwd, name, 'requirements') ?? ''
  const design = readPhase(cwd, name, 'design') ?? ''
  const tasks = parseTasks(readPhase(cwd, name, 'tasks') ?? '')
  const context: KernelContext = {
    cwd,
    specName: spec.name,
    goal: spec.goal,
  }
  const baseContext = `Requirements:\n${requirements}\n\nDesign:\n${design}`.slice(0, 6000)

  return tasks
    .filter(t => !t.done)
    .map(task => ({
      name: `spec-${spec.name}-${task.id}`,
      role: 'executor' as const,
      goal: task.title,
      context,
      instructions:
        `You are implementing one task of a specced feature.\n\n${baseContext}\n\nYour task ${task.id}: ${task.title}\n\n` +
        `Implement only this task, consistent with the requirements and design. End your reply with VERDICT: PASS if complete, or VERDICT: FAIL.`,
      meta: { taskId: task.id, taskTitle: task.title },
    }))
}

export function mapStageResultsToSpecRunResult(
  spec: SpecMeta,
  results: KernelResult[],
): SpecRunResult {
  const pairs = results
    .map(r => ({ result: r, stage: asSpecRunStage(r.stage) }))
    .filter((p): p is { result: KernelResult; stage: SpecRunStage } => p.stage !== null)
  const ran = pairs.map(p => ({
    id: p.stage.meta.taskId,
    title: p.stage.meta.taskTitle,
    status: (stageSucceeded(p.result) ? 'done' : 'failed') as 'done' | 'failed',
  }))

  const stoppedOnFailure = pairs.some(p => !stageSucceeded(p.result))
  return {
    name: spec.name,
    ran,
    remaining: 0, // Caller re-reads tasks; kernel path marks done via artifacts.
    stoppedOnFailure,
  }
}

export async function runSpecWithKernel(
  cwd: string,
  name: string,
  kernel: AgentKernel,
  options: { dryRun?: boolean; maxTurns?: number; skipPermissions?: boolean; all?: boolean; runner?: import('./headlessAgent.js').HeadlessRunner },
): Promise<SpecRunResult> {
  const spec = loadSpec(cwd, name)
  if (!spec) throw new Error(`Spec not found: ${name}`)

  const stages = planSpecRun(cwd, name)
  const results: KernelResult[] = []

  for (const stage of stages) {
    const result = await runKernelStage(kernel, stage, {
      cwd,
      dryRun: options.dryRun,
      maxTurns: options.maxTurns,
      skipPermissions: options.skipPermissions,
      runner: options.runner,
    })
    results.push(result)
    const succeeded = stageSucceeded(result)
    if (!succeeded && stage.context.stopOnError !== false) break
    const specStage = asSpecRunStage(stage)
    if (succeeded && specStage && !options.dryRun) {
      const tasksMd = readPhase(cwd, name, 'tasks') ?? ''
      writePhase(cwd, name, 'tasks', markTaskDone(tasksMd, specStage.meta.taskId))
    }
    if (!options.all) break
  }

  return mapStageResultsToSpecRunResult(spec, results)
}

export function planSpecVerify(cwd: string, name: string): KernelStage {
  const spec = loadSpec(cwd, name)
  if (!spec) throw new Error(`Spec not found: ${name}`)
  const requirements = readPhase(cwd, name, 'requirements') ?? ''
  const design = readPhase(cwd, name, 'design') ?? ''
  const tasks = parseTasks(readPhase(cwd, name, 'tasks') ?? '')

  return {
    name: `spec-${spec.name}-verify`,
    role: 'verifier',
    goal: `Verify spec ${spec.name}: ${spec.goal}`,
    context: {
      cwd,
      specName: spec.name,
      goal: spec.goal,
    },
    instructions: [
      'You are verifying the implementation of a specced feature.',
      '',
      '=== CRITICAL ===',
      'You are STRICTLY PROHIBITED from modifying the project. Read, run commands, and inspect only.',
      'You must be stricter than the implementer. No proof = no PASS.',
      '',
      '=== REQUIRED PROOFS ===',
      'Before PASS, confirm ALL of the following with command-run evidence:',
      '1. Compile proof: the project builds.',
      '2. Test proof: the relevant test suite passes.',
      '3. Lint proof: configured linters/type-checkers pass.',
      '4. Diff proof: changed files match the spec.',
      '5. Runtime proof: the feature behaves as required.',
      '',
      '=== SPEC ===',
      `Goal: ${spec.goal}`,
      '',
      'Requirements:',
      requirements || '(none written)',
      '',
      'Design:',
      design || '(none written)',
      '',
      'Tasks:',
      tasks.map(t => `- [${t.done ? 'x' : ' '}] ${t.id}: ${t.title}`).join('\n'),
      '',
      '=== OUTPUT FORMAT ===',
      'Each check MUST include the exact command you ran and the observed output.',
      'End with exactly one line: VERDICT: PASS, VERDICT: FAIL, or VERDICT: PARTIAL.',
    ].join('\n'),
  }
}

export function mapKernelResultToSpecVerifyResult(result: KernelResult): SpecVerifyResult {
  const verdict = result.isError ? 'FAIL' : result.verdict ?? 'PARTIAL'
  const evidence = result.artifacts.find(artifact => artifact.kind === 'record' && artifact.path === 'verification-evidence')
  return {
    verdict,
    summary:
      verdict === 'PASS'
        ? 'All required proofs (compile, test, lint, diff, runtime) were demonstrated by the verifier.'
        : verdict === 'FAIL'
          ? 'The verifier found failing evidence. See subagent output for details.'
          : 'The verifier could not reach a definitive PASS/FAIL verdict.',
    commandFailures: result.artifacts.filter(a => a.kind === 'note' && a.text.startsWith('FAIL gate')).length,
    gateResults: [],
    subagentOutput: result.output,
    generatedAt: new Date().toISOString(),
    ...(evidence?.kind === 'record' ? { evidence: evidence.record as VerificationEvidence } : {}),
  }
}

export async function runSpecVerifyWithKernel(
  cwd: string,
  name: string,
  kernel: AgentKernel,
  options: { dryRun?: boolean; maxTurns?: number; skipPermissions?: boolean; runner?: import('./headlessAgent.js').HeadlessRunner },
): Promise<SpecVerifyResult> {
  const stage = planSpecVerify(cwd, name)
  const result = await runKernelStage(kernel, stage, {
    cwd,
    dryRun: options.dryRun,
    maxTurns: options.maxTurns,
    skipPermissions: options.skipPermissions,
    runner: options.runner,
  })
  const mapped = mapKernelResultToSpecVerifyResult(result)
  if (!options.dryRun) persistVerificationResult(cwd, name, mapped)
  return mapped
}
