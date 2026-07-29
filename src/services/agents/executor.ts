import {
  type WorkflowGate,
  type WorkflowSpec,
  type WorkflowStep,
  validateWorkflow,
} from './workflows.js'

/**
 * Live workflow executor.
 *
 * Drives a workflow DAG to completion through a pluggable step-runner: it
 * resolves dependencies, runs each ready step, enforces approval/verification
 * gates, writes checkpoints, and — when given a review loop (PEER) — re-opens
 * and re-runs the loop body until the reviewer returns PASS or the iteration
 * budget is exhausted. The engine is deterministic and runner-agnostic; the
 * actual agent spawning lives in the injected `runStep` (see cliStepRunner).
 */

export type Verdict = 'PASS' | 'FAIL' | 'PARTIAL'

export type StepRunInput = {
  step: WorkflowStep
  /** 1-based review-loop cycle this run belongs to. */
  iteration: number
  /** Outputs of the step's direct dependencies, keyed by step id. */
  priorOutputs: Record<string, string>
  /** Reviewer feedback injected when a loop re-opens this step. */
  feedback?: string
}

export type StepRunOutput = {
  output: string
  verdict?: Verdict | null
  isError?: boolean
}

export type StepRunner = (input: StepRunInput) => Promise<StepRunOutput>

export type ExecLoop = { from: string; to: string; maxIterations: number }

export type ExecStatus =
  | 'completed'
  | 'failed'
  | 'held'
  | 'max-iterations'
  | 'cyclic'

export type ExecEvent =
  | { kind: 'wave'; ids: string[]; iteration: number }
  | { kind: 'step-start'; id: string; agent: string; iteration: number }
  | { kind: 'step-done'; id: string; verdict?: Verdict | null; isError?: boolean }
  | {
      kind: 'gate'
      id: string
      gate: WorkflowGate
      result: 'pass' | 'fail' | 'hold' | 'advisory'
    }
  | { kind: 'loop'; from: string; to: string; iteration: number }
  | { kind: 'finish'; status: ExecStatus }

export type ExecStepResult = {
  id: string
  agent: string
  status: 'done' | 'failed' | 'held' | 'skipped'
  verdict?: Verdict | null
  iterations: number
  output: string
  error?: string
}

export type ExecResult = {
  name: string
  status: ExecStatus
  iterations: number
  steps: ExecStepResult[]
}

export type ExecuteOptions = {
  runStep: StepRunner
  loop?: ExecLoop | null
  onEvent?: (event: ExecEvent) => void
  /**
   * Called whenever the authoritative completed set changes. Use this for
   * crash-recovery persistence, including review loops that reopen prior steps.
   */
  onProgress?: (
    stepId: string,
    completed: string[],
    outputs: Readonly<Record<string, string>>,
  ) => void
  /** Called only after a step with `checkpoint: true` is marked done. */
  onCheckpoint?: (stepId: string, completed: string[]) => void
  /** Step ids already completed (resume). */
  resumeCompleted?: string[]
  /** Exact persisted outputs for completed steps (resume). */
  resumeOutputs?: Readonly<Record<string, string>>
  /** Decide approval gates. Defaults to holding (false) so nothing auto-approves. */
  approve?: (step: WorkflowStep) => boolean | Promise<boolean>
  /** Stop the whole run if a step errors (default true). */
  stopOnError?: boolean
  /**
   * Maximum number of independent ready steps to run concurrently. Defaults to
   * DEFAULT_MAX_CONCURRENCY. Set to 1 to force strictly sequential execution.
   * All gated steps run alone so their control-flow decision is deterministic.
   */
  maxConcurrency?: number
}

/** Default fan-out width when a workflow exposes several independent steps. */
export const DEFAULT_MAX_CONCURRENCY = 4

export async function executeWorkflow(
  spec: WorkflowSpec,
  options: ExecuteOptions,
): Promise<ExecResult> {
  const validation = validateWorkflow(spec)
  const emit = (event: ExecEvent) => options.onEvent?.(event)
  if (!validation.valid) {
    emit({ kind: 'finish', status: 'cyclic' })
    return { name: spec.name, status: 'cyclic', iterations: 0, steps: [] }
  }

  const order = validation.order
  const byId = new Map(spec.steps.map(step => [step.id, step]))
  const done = new Set(
    (options.resumeCompleted ?? []).filter(stepId => byId.has(stepId)),
  )
  const outputs: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >
  for (const stepId of done) {
    if (
      options.resumeOutputs != null &&
      Object.prototype.hasOwnProperty.call(options.resumeOutputs, stepId) &&
      typeof options.resumeOutputs[stepId] === 'string'
    ) {
      outputs[stepId] = options.resumeOutputs[stepId] as string
    }
  }
  const results = new Map<string, ExecStepResult>()
  const loop = options.loop ?? null

  let cycle = 1
  let pendingFeedback: string | undefined
  let pendingFeedbackFor: string | undefined

  const recordResult = (
    step: WorkflowStep,
    patch: Partial<ExecStepResult>,
  ): ExecStepResult => {
    const prior = results.get(step.id)
    const next: ExecStepResult = {
      id: step.id,
      agent: step.agent,
      status: patch.status ?? prior?.status ?? 'skipped',
      verdict: patch.verdict ?? prior?.verdict ?? null,
      iterations: (prior?.iterations ?? 0) + (patch.iterations ?? 0),
      output: patch.output ?? prior?.output ?? '',
      error: patch.error ?? prior?.error,
    }
    results.set(step.id, next)
    return next
  }

  // A resumed completed step is still done; it was not skipped by this run.
  // Keep iterations at zero to make the no-replay guarantee observable.
  for (const stepId of done) {
    const step = byId.get(stepId)
    if (!step) continue
    results.set(stepId, {
      id: step.id,
      agent: step.agent,
      status: 'done',
      verdict: null,
      iterations: 0,
      output: Object.prototype.hasOwnProperty.call(outputs, stepId)
        ? outputs[stepId] as string
        : '',
    })
  }

  const finish = (status: ExecStatus): ExecResult => {
    emit({ kind: 'finish', status })
    const steps = order.map(
      id =>
        results.get(id) ?? {
          id,
          agent: byId.get(id)?.agent ?? 'general-purpose',
          status: 'skipped' as const,
          verdict: null,
          iterations: 0,
          output: '',
        },
    )
    return { name: spec.name, status, iterations: cycle, steps }
  }

  // Guard against runaway loops independent of the configured budget.
  const hardCap = (loop?.maxIterations ?? 1) * order.length + order.length + 8
  const maxConcurrency = Math.max(
    1,
    Math.floor(options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY),
  )
  const stopOnError = options.stopOnError !== false
  let safety = 0

  const readyNow = (): string[] =>
    order.filter(
      id =>
        !done.has(id) &&
        (byId.get(id)?.dependsOn ?? []).every(dep => done.has(dep)),
    )

  // Every gate runs sequentially because its outcome can branch control flow.
  // Approval is checked before runStep, and verification is fail-closed unless
  // the workflow explicitly marks it advisory.
  const needsSequential = (id: string): boolean => {
    const s = byId.get(id)
    if (!s) return true
    return s.gate != null
  }

  const priorOutputsFor = (step: WorkflowStep): Record<string, string> => {
    const collected: Record<string, string> = Object.create(null) as Record<
      string,
      string
    >
    for (const dep of step.dependsOn ?? []) {
      if (Object.prototype.hasOwnProperty.call(outputs, dep)) {
        collected[dep] = outputs[dep] as string
      }
    }
    return collected
  }

  const outputSnapshot = (): Readonly<Record<string, string>> =>
    Object.fromEntries(
      [...done]
        .filter(stepId =>
          Object.prototype.hasOwnProperty.call(outputs, stepId),
        )
        .map(stepId => [stepId, outputs[stepId] as string]),
    )

  const reportProgress = (stepId: string): void => {
    options.onProgress?.(stepId, [...done], outputSnapshot())
  }

  const missingRequiredOutputs = (step: WorkflowStep): string[] => {
    const dependencies = step.dependsOn ?? []
    const needsEveryDependency = step.prompt.includes('{{prior}}')
    return dependencies.filter(
      dependency =>
        (needsEveryDependency ||
          step.prompt.includes(`{{${dependency}}}`)) &&
        !Object.prototype.hasOwnProperty.call(outputs, dependency),
    )
  }

  const failMissingOutputs = (
    step: WorkflowStep,
    missing: string[],
  ): ExecResult => {
    recordResult(step, {
      status: 'failed',
      error:
        `Cannot resume "${step.id}": required persisted output is unavailable for ` +
        `${missing.join(', ')}. Completed steps were not replayed; reset the workflow to rerun them intentionally.`,
    })
    return finish('failed')
  }

  // Run a batch of independent fan-out steps concurrently. They are launched
  // together but their results are folded back in deterministic topological
  // order, so outputs, checkpoints, and early-stop behavior are identical to a
  // sequential run — only wall-clock time changes. Returns a terminal
  // ExecResult when the run must stop, otherwise null.
  const runBatch = async (ids: string[]): Promise<ExecResult | null> => {
    for (const id of ids) {
      const step = byId.get(id) as WorkflowStep
      const missing = missingRequiredOutputs(step)
      if (missing.length > 0) return failMissingOutputs(step, missing)
    }
    emit({ kind: 'wave', ids: [...ids], iteration: cycle })
    const launched = ids.map(id => {
      const batchStep = byId.get(id) as WorkflowStep
      const stepFeedback = pendingFeedbackFor === id ? pendingFeedback : undefined
      emit({
        kind: 'step-start',
        id: batchStep.id,
        agent: batchStep.agent,
        iteration: cycle,
      })
      return { step: batchStep, feedback: stepFeedback }
    })
    // Feedback (if any) is consumed by the matching step in this batch.
    if (pendingFeedbackFor != null && ids.includes(pendingFeedbackFor)) {
      pendingFeedback = undefined
      pendingFeedbackFor = undefined
    }
    const settled = await Promise.allSettled(
      launched.map(({ step: batchStep, feedback: stepFeedback }) =>
        options.runStep({
          step: batchStep,
          iteration: cycle,
          priorOutputs: priorOutputsFor(batchStep),
          feedback: stepFeedback,
        }),
      ),
    )

    let batchFailed = false
    for (let i = 0; i < ids.length; i++) {
      const batchStep = byId.get(ids[i]) as WorkflowStep
      const outcome = settled[i]
      if (outcome.status === 'rejected') {
        const { reason } = outcome
        recordResult(batchStep, {
          status: 'failed',
          iterations: 1,
          error: reason instanceof Error ? reason.message : String(reason),
        })
        emit({ kind: 'step-done', id: batchStep.id, isError: true })
        batchFailed = true
        continue
      }
      const run = outcome.value
      outputs[batchStep.id] = run.output
      recordResult(batchStep, {
        iterations: 1,
        output: run.output,
        verdict: run.verdict ?? null,
        error: run.isError ? run.output : undefined,
      })
      emit({
        kind: 'step-done',
        id: batchStep.id,
        verdict: run.verdict ?? null,
        isError: run.isError,
      })
      if (run.isError && stopOnError) {
        recordResult(batchStep, { status: 'failed' })
        batchFailed = true
        continue
      }
      recordResult(batchStep, { status: 'done' })
      done.add(batchStep.id)
      reportProgress(batchStep.id)
      if (batchStep.checkpoint === true) {
        options.onCheckpoint?.(batchStep.id, [...done])
      }
    }
    // Promise.allSettled means every branch already ran. Fold every outcome
    // before stopping so successful siblings are persisted and no executed
    // branch is falsely reported as skipped merely because an earlier sibling
    // failed in deterministic display order.
    return batchFailed ? finish('failed') : null
  }

  while (safety++ < hardCap) {
    const ready = readyNow()
    if (ready.length === 0) break

    // Greedily batch a prefix of consecutive fan-out steps (in topological
    // order) up to the concurrency cap, stopping at the first gated step so
    // approval and verification semantics remain exact.
    const batch: string[] = []
    if (maxConcurrency > 1) {
      for (const id of ready) {
        if (needsSequential(id)) break
        batch.push(id)
        if (batch.length >= maxConcurrency) break
      }
    }

    if (batch.length >= 2) {
      const stop = await runBatch(batch)
      if (stop) return stop
      continue
    }

    // Single-step path: covers all gated steps and sequential execution.
    const nextId = ready[0]
    const step = byId.get(nextId)
    if (!step) break

    // Approval protects the step itself: never start or invoke the runner until
    // the gate has passed. The default remains fail-safe (hold).
    if (step.gate === 'approval') {
      let approved = false
      try {
        approved = options.approve ? await options.approve(step) : false
      } catch (error) {
        recordResult(step, {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        })
        emit({
          kind: 'gate',
          id: step.id,
          gate: 'approval',
          result: 'fail',
        })
        return finish('failed')
      }
      emit({
        kind: 'gate',
        id: step.id,
        gate: 'approval',
        result: approved ? 'pass' : 'hold',
      })
      if (!approved) {
        recordResult(step, { status: 'held' })
        return finish('held')
      }
    }

    const missingOutputs = missingRequiredOutputs(step)
    if (missingOutputs.length > 0) {
      return failMissingOutputs(step, missingOutputs)
    }

    emit({ kind: 'step-start', id: step.id, agent: step.agent, iteration: cycle })

    const feedback =
      pendingFeedbackFor === step.id ? pendingFeedback : undefined
    if (feedback !== undefined) {
      pendingFeedback = undefined
      pendingFeedbackFor = undefined
    }

    const priorOutputs = priorOutputsFor(step)

    let run: StepRunOutput
    try {
      run = await options.runStep({
        step,
        iteration: cycle,
        priorOutputs,
        feedback,
      })
    } catch (error) {
      recordResult(step, {
        status: 'failed',
        iterations: 1,
        error: error instanceof Error ? error.message : String(error),
      })
      emit({ kind: 'step-done', id: step.id, isError: true })
      return finish('failed')
    }

    outputs[step.id] = run.output
    recordResult(step, {
      iterations: 1,
      output: run.output,
      verdict: run.verdict ?? null,
      error: run.isError ? run.output : undefined,
    })
    emit({
      kind: 'step-done',
      id: step.id,
      verdict: run.verdict ?? null,
      isError: run.isError,
    })

    if (run.isError && stopOnError) {
      recordResult(step, { status: 'failed' })
      return finish('failed')
    }

    // Verification gates are enforcing by default. A missing/PARTIAL/FAIL
    // verdict cannot complete a workflow unless the spec explicitly selects
    // advisory mode.
    if (step.gate === 'verification') {
      const passed = run.isError !== true && run.verdict === 'PASS'
      if (passed) {
        emit({ kind: 'gate', id: step.id, gate: 'verification', result: 'pass' })
      } else if (run.isError) {
        emit({ kind: 'gate', id: step.id, gate: 'verification', result: 'fail' })
        recordResult(step, {
          status: 'failed',
          error: run.output || 'Verification runner failed',
        })
        return finish('failed')
      } else if (loop != null && loop.from === step.id) {
        emit({ kind: 'gate', id: step.id, gate: 'verification', result: 'fail' })
        if (cycle < loop.maxIterations) {
          const start = order.indexOf(loop.to)
          const end = order.indexOf(loop.from)
          for (const id of order.slice(start, end + 1)) {
            done.delete(id)
            delete outputs[id]
          }
          reportProgress(loop.to)
          pendingFeedback = run.output
          pendingFeedbackFor = loop.to
          cycle++
          emit({
            kind: 'loop',
            from: loop.from,
            to: loop.to,
            iteration: cycle,
          })
          continue
        }
        recordResult(step, {
          status: 'failed',
          error:
            run.verdict == null
              ? 'Verification gate returned no verdict'
              : `Verification gate returned ${run.verdict}`,
        })
        return finish('max-iterations')
      } else if (step.verificationMode === 'advisory') {
        emit({
          kind: 'gate',
          id: step.id,
          gate: 'verification',
          result: 'advisory',
        })
      } else {
        emit({ kind: 'gate', id: step.id, gate: 'verification', result: 'fail' })
        recordResult(step, {
          status: 'failed',
          error:
            run.verdict == null
              ? 'Verification gate returned no verdict'
              : `Verification gate returned ${run.verdict}`,
        })
        return finish('failed')
      }
    }

    recordResult(step, { status: 'done' })
    done.add(step.id)
    reportProgress(step.id)
    if (step.checkpoint === true) {
      options.onCheckpoint?.(step.id, [...done])
    }
  }

  return finish(done.size === order.length ? 'completed' : 'failed')
}

export function formatExecResult(result: ExecResult): string {
  const mark: Record<ExecStepResult['status'], string> = {
    done: '✓',
    failed: '✗',
    held: '⏸',
    skipped: '·',
  }
  const lines = [
    `Execution: ${result.name}`,
    `Status: ${result.status}   Cycles: ${result.iterations}`,
    '',
  ]
  for (const step of result.steps) {
    const verdict = step.verdict ? `  VERDICT: ${step.verdict}` : ''
    const iters = step.iterations > 1 ? `  (${step.iterations} runs)` : ''
    lines.push(`${mark[step.status]} ${step.id} (${step.agent})${verdict}${iters}`)
    if (step.error) lines.push(`    error: ${step.error}`)
    else if (step.output) lines.push(`    ${preview(step.output)}`)
  }
  return lines.join('\n')
}

function preview(text: string, max = 200): string {
  const value = text.replace(/\s+/g, ' ').trim()
  return value.length <= max ? value : `${value.slice(0, max)}…`
}
