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
  /** Called after a step is marked done; persist the completed set here. */
  onCheckpoint?: (stepId: string, completed: string[]) => void
  /** Step ids already completed (resume). */
  resumeCompleted?: string[]
  /** Decide approval gates. Defaults to holding (false) so nothing auto-approves. */
  approve?: (step: WorkflowStep) => boolean | Promise<boolean>
  /** Stop the whole run if a step errors. */
  stopOnError?: boolean
  /**
   * Maximum number of independent ready steps to run concurrently. Defaults to
   * DEFAULT_MAX_CONCURRENCY. Set to 1 to force strictly sequential execution.
   * Gated steps (approval, enforcing verification loop) always run alone.
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
  const done = new Set(options.resumeCompleted ?? [])
  const outputs: Record<string, string> = {}
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
  let safety = 0

  const readyNow = (): string[] =>
    order.filter(
      id =>
        !done.has(id) &&
        (byId.get(id)?.dependsOn ?? []).every(dep => done.has(dep)),
    )

  // A step must run sequentially when its post-run outcome can branch control
  // flow: an approval gate may hold the run, and the enforcing loop's
  // verification step may re-open the loop. Every other step is a pure
  // fan-out node whose mutually independent ready peers can run concurrently.
  const needsSequential = (id: string): boolean => {
    const s = byId.get(id)
    if (!s) return true
    if (s.gate === 'approval') return true
    if (loop != null && loop.from === id && s.gate === 'verification') return true
    return false
  }

  const priorOutputsFor = (step: WorkflowStep): Record<string, string> => {
    const collected: Record<string, string> = {}
    for (const dep of step.dependsOn ?? []) {
      if (outputs[dep] !== undefined) collected[dep] = outputs[dep]
    }
    return collected
  }

  // Run a batch of independent fan-out steps concurrently. They are launched
  // together but their results are folded back in deterministic topological
  // order, so outputs, checkpoints, and early-stop behavior are identical to a
  // sequential run — only wall-clock time changes. Returns a terminal
  // ExecResult when the run must stop, otherwise null.
  const runBatch = async (ids: string[]): Promise<ExecResult | null> => {
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
        return finish('failed')
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
      if (run.isError && options.stopOnError) {
        recordResult(batchStep, { status: 'failed' })
        return finish('failed')
      }
      // Only non-enforcing verification gates can reach a batch (the enforcing
      // loop step is always handled sequentially), so this is advisory.
      if (batchStep.gate === 'verification') {
        emit({
          kind: 'gate',
          id: batchStep.id,
          gate: 'verification',
          result: 'advisory',
        })
      }
      recordResult(batchStep, { status: 'done' })
      done.add(batchStep.id)
      options.onCheckpoint?.(batchStep.id, [...done])
    }
    return null
  }

  while (safety++ < hardCap) {
    const ready = readyNow()
    if (ready.length === 0) break

    // Greedily batch a prefix of consecutive fan-out steps (in topological
    // order) up to the concurrency cap, stopping at the first step that needs
    // sequential handling so approval / verification-loop semantics are exact.
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

    // Single-step path: covers approval gates and the verification loop.
    const nextId = ready[0]
    const step = byId.get(nextId)
    if (!step) break

    emit({ kind: 'step-start', id: step.id, agent: step.agent, iteration: cycle })

    const feedback =
      pendingFeedbackFor === step.id ? pendingFeedback : undefined
    if (feedback !== undefined) {
      pendingFeedback = undefined
      pendingFeedbackFor = undefined
    }

    const priorOutputs: Record<string, string> = {}
    for (const dep of step.dependsOn ?? []) {
      if (outputs[dep] !== undefined) priorOutputs[dep] = outputs[dep]
    }

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

    if (run.isError && options.stopOnError) {
      recordResult(step, { status: 'failed' })
      return finish('failed')
    }

    // Approval gate.
    if (step.gate === 'approval') {
      const approved = options.approve ? await options.approve(step) : false
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

    // Verification gate: enforcing only when a loop targets this step.
    if (step.gate === 'verification') {
      const enforcing = loop != null && loop.from === step.id
      if (enforcing) {
        if (run.verdict === 'PASS') {
          emit({ kind: 'gate', id: step.id, gate: 'verification', result: 'pass' })
        } else {
          emit({ kind: 'gate', id: step.id, gate: 'verification', result: 'fail' })
          if (cycle < (loop as ExecLoop).maxIterations) {
            const start = order.indexOf((loop as ExecLoop).to)
            const end = order.indexOf((loop as ExecLoop).from)
            for (const id of order.slice(start, end + 1)) done.delete(id)
            pendingFeedback = run.output
            pendingFeedbackFor = (loop as ExecLoop).to
            cycle++
            emit({
              kind: 'loop',
              from: (loop as ExecLoop).from,
              to: (loop as ExecLoop).to,
              iteration: cycle,
            })
            continue
          }
          recordResult(step, { status: 'failed' })
          return finish('max-iterations')
        }
      } else {
        emit({ kind: 'gate', id: step.id, gate: 'verification', result: 'advisory' })
      }
    }

    recordResult(step, { status: 'done' })
    done.add(step.id)
    options.onCheckpoint?.(step.id, [...done])
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
