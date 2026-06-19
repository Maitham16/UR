import { makeCliStepRunner, makeDryRunner } from './cliStepRunner.js'
import {
  type ExecEvent,
  type ExecLoop,
  type ExecResult,
  executeWorkflow,
} from './executor.js'
import { getPattern } from './patterns.js'
import {
  type WorkflowSpec,
  loadRunState,
  markStepComplete,
  resetRunState,
  saveWorkflow,
} from './workflows.js'

export type RunWorkflowOptions = {
  cwd: string
  /** State key for checkpoints (defaults to spec.name). */
  stateName?: string
  dryRun?: boolean
  live?: boolean
  maxTurns?: number
  skipPermissions?: boolean
  resume?: boolean
  /** Explicit review loop; otherwise derived from spec.pattern. */
  loop?: ExecLoop | null
  /** Max independent steps to run concurrently (1 = sequential). */
  maxConcurrency?: number
  onEvent?: (event: ExecEvent) => void
}

/** Derive the review loop for a workflow compiled from a pattern (e.g. PEER). */
export function deriveLoop(spec: WorkflowSpec): ExecLoop | null {
  if (!spec.pattern) return null
  const pattern = getPattern(spec.pattern)
  if (!pattern?.loop) return null
  return {
    from: pattern.loop.from,
    to: pattern.loop.to,
    maxIterations: pattern.loop.maxIterations,
  }
}

export async function runWorkflowSpec(
  spec: WorkflowSpec,
  options: RunWorkflowOptions,
): Promise<ExecResult> {
  const stateName = options.stateName ?? spec.name
  const loop = options.loop ?? deriveLoop(spec)

  let resumeCompleted: string[] = []
  if (options.resume) {
    resumeCompleted = loadRunState(options.cwd, stateName)?.completed ?? []
  } else {
    resetRunState(options.cwd, stateName)
  }

  const runStep = options.dryRun
    ? makeDryRunner()
    : makeCliStepRunner({
        cwd: options.cwd,
        maxTurns: options.maxTurns,
        skipPermissions: options.skipPermissions,
      })

  return executeWorkflow(spec, {
    runStep,
    loop,
    resumeCompleted,
    maxConcurrency: options.maxConcurrency,
    onEvent: options.onEvent,
    onCheckpoint: stepId => {
      markStepComplete(options.cwd, stateName, stepId)
    },
  })
}

/** Persist a spec then run it (used by pattern --execute). */
export async function saveAndRunWorkflow(
  spec: WorkflowSpec,
  options: RunWorkflowOptions,
): Promise<ExecResult> {
  saveWorkflow(options.cwd, spec, { force: true })
  return runWorkflowSpec(spec, options)
}
