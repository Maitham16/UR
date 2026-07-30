import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { safeParseJSON } from '../../utils/json.js'
import {
  readPrivateText,
  withPrivateStateLock,
  writePrivateTextAtomic,
} from '../../utils/privateState.js'

/**
 * Declarative, checkpointed agent workflows.
 *
 * A workflow is a DAG of agent steps. Each step names the subagent that should
 * run it, a self-contained prompt, the steps it depends on, and optional
 * approval/verification gates and checkpoints. This is the CLI-native answer to
 * a visual workflow canvas: the same graph can be validated, topologically
 * ordered, rendered (Mermaid / ASCII), executed step-by-step, and resumed from
 * the last completed checkpoint.
 */

export type WorkflowGate = 'approval' | 'verification'

export type WorkflowStep = {
  id: string
  name: string
  /** UR subagent_type that should execute this step. */
  agent: string
  /** Self-contained instructions for the step's agent. */
  prompt: string
  /** Exact tool pool exposed to this step. Omit to use the normal pool. */
  allowedTools?: string[]
  /** Step ids that must complete before this step (DAG edges). */
  dependsOn?: string[]
  /** Human gate that must clear before the step is considered done. */
  gate?: WorkflowGate
  /**
   * Verification gates enforce PASS by default. Set this explicitly to
   * `advisory` only when a reviewer result is informational.
   */
  verificationMode?: 'enforcing' | 'advisory'
  /** Persist run state after this step so a run can resume here. */
  checkpoint?: boolean
}

export type WorkflowSpec = {
  version: 1
  name: string
  description?: string
  /** Source collaboration pattern id, when compiled from one (peer/doe). */
  pattern?: string
  steps: WorkflowStep[]
}

export type WorkflowValidation = {
  valid: boolean
  errors: string[]
  warnings: string[]
  /** Topological execution order (step ids); empty when the graph has a cycle. */
  order: string[]
}

export type RunState = {
  version: 1
  name: string
  startedAt: string
  updatedAt: string
  /** Latest completed set used for crash recovery. Present in legacy v1 files. */
  completed: string[]
  /**
   * Exact outputs for completed steps, when they fit the persistence budget.
   * Empty strings are valid outputs and are therefore stored explicitly.
   */
  outputs?: Record<string, string>
  /**
   * Completed steps whose output was never captured or exceeded the bounded
   * persistence budget. Output-dependent successors fail closed on resume.
   */
  unavailableOutputs?: string[]
  /** Approval-gated steps explicitly approved after entering a held state. */
  approved?: string[]
  /** Gate currently waiting for explicit human approval. */
  awaitingApproval?: string
  /** Semantic checkpoints; ordinary crash-recovery writes do not appear here. */
  checkpoints?: Array<{
    stepId: string
    completed: string[]
    createdAt: string
  }>
  status?: 'running' | 'held' | 'completed' | 'failed'
}

export type RunStepStatus = 'done' | 'ready' | 'blocked' | 'held'

export type RunPlanStep = {
  id: string
  name: string
  agent: string
  status: RunStepStatus
  dependsOn: string[]
  gate?: WorkflowGate
  checkpoint: boolean
}

export type RunPlan = {
  name: string
  total: number
  completed: number
  steps: RunPlanStep[]
  nextStepId: string | null
}

/**
 * Built-in subagent types plus installable template agents. Unknown agents are
 * a warning, not an error, so custom `.ur/agents/*` definitions remain valid.
 */
export const KNOWN_AGENTS: readonly string[] = [
  'general-purpose',
  'worker',
  'plan',
  'explore',
  'verification',
  'statusline-setup',
  // Must match UR_CODE_GUIDE_AGENT_TYPE in AgentTool/built-in/urCodeGuideAgent.
  // This read 'ur-code-guide', which is not a registered agent: a workflow
  // using the real 'ur-guide' was warned as unknown, while the name listed
  // here would have been accepted despite resolving to nothing.
  'ur-guide',
  // installable templates (see featureScaffolds.AGENT_TEMPLATES)
  'reviewer',
  'test-runner',
  'browser-debugger',
  'docs-researcher',
  'security-auditor',
  'release-notes',
  'pr-fixer',
  'memory-curator',
]

const NAME_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/i

export function slugifyWorkflowName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

export function workflowsDir(cwd: string): string {
  return join(cwd, '.ur', 'workflows')
}

function stateDir(cwd: string): string {
  return join(workflowsDir(cwd), '.state')
}

export function workflowPath(cwd: string, name: string): string {
  return join(workflowsDir(cwd), `${slugifyWorkflowName(name)}.yaml`)
}

function statePath(cwd: string, name: string): string {
  return join(stateDir(cwd), `${slugifyWorkflowName(name)}.json`)
}

const MAX_RUN_STATE_BYTES = 2 * 1024 * 1024
/** Per-step persisted output budget; oversized outputs are never truncated. */
export const MAX_PERSISTED_STEP_OUTPUT_BYTES = 32 * 1024
/** Aggregate persisted output budget, kept below the run-state file limit. */
export const MAX_PERSISTED_RUN_OUTPUT_BYTES = 256 * 1024

function boundRunOutputs(
  completed: readonly string[],
  supplied: Readonly<Record<string, string>> | undefined,
): Pick<RunState, 'outputs' | 'unavailableOutputs'> {
  const outputs: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >
  const unavailableOutputs: string[] = []
  let totalBytes = 0

  for (const stepId of completed) {
    const hasOutput =
      supplied != null &&
      Object.prototype.hasOwnProperty.call(supplied, stepId) &&
      typeof supplied[stepId] === 'string'
    if (!hasOutput) {
      unavailableOutputs.push(stepId)
      continue
    }
    const output = supplied[stepId] as string
    const outputBytes = Buffer.byteLength(output, 'utf8')
    if (
      outputBytes > MAX_PERSISTED_STEP_OUTPUT_BYTES ||
      totalBytes + outputBytes > MAX_PERSISTED_RUN_OUTPUT_BYTES
    ) {
      unavailableOutputs.push(stepId)
      continue
    }
    outputs[stepId] = output
    totalBytes += outputBytes
  }

  return { outputs, unavailableOutputs }
}

function withRunStateLock<T>(
  cwd: string,
  name: string,
  operation: () => T,
): T {
  const slug = slugifyWorkflowName(name) || 'workflow'
  return withPrivateStateLock(stateDir(cwd), `workflow-${slug}`, operation)
}

/** Parse a workflow from YAML or JSON text. */
export function parseWorkflowText(text: string): WorkflowSpec {
  const trimmed = text.trim()
  const parsed = trimmed.startsWith('{')
    ? safeParseJSON(trimmed, false)
    : (parseYaml(trimmed) as unknown)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Workflow is not an object')
  }
  const spec = parsed as Partial<WorkflowSpec>
  if (!spec.name || !Array.isArray(spec.steps)) {
    throw new Error('Workflow must have a name and a steps array')
  }
  return {
    version: 1,
    name: String(spec.name),
    description: spec.description ? String(spec.description) : undefined,
    pattern: spec.pattern ? String(spec.pattern) : undefined,
    steps: spec.steps.map(normalizeStep),
  }
}

function normalizeStep(raw: unknown, index: number): WorkflowStep {
  const step = (raw ?? {}) as Partial<WorkflowStep>
  const gate =
    step.gate === 'approval' || step.gate === 'verification'
      ? step.gate
      : undefined
  return {
    id: String(step.id ?? `step-${index + 1}`),
    name: String(step.name ?? step.id ?? `Step ${index + 1}`),
    agent: String(step.agent ?? 'general-purpose'),
    prompt: String(step.prompt ?? ''),
    allowedTools: Array.isArray(step.allowedTools)
      ? step.allowedTools.map(String)
      : undefined,
    dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn.map(String) : [],
    gate,
    verificationMode:
      gate === 'verification' &&
      (step.verificationMode === 'enforcing' ||
        step.verificationMode === 'advisory')
        ? step.verificationMode
        : undefined,
    checkpoint: step.checkpoint === true,
  }
}

function topoOrder(
  steps: WorkflowStep[],
): { order: string[] } | { cycle: string[] } {
  const ids = new Set(steps.map(step => step.id))
  const indegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()
  for (const step of steps) {
    indegree.set(step.id, 0)
    adjacency.set(step.id, [])
  }
  for (const step of steps) {
    for (const dep of step.dependsOn ?? []) {
      if (!ids.has(dep)) continue
      adjacency.get(dep)?.push(step.id)
      indegree.set(step.id, (indegree.get(step.id) ?? 0) + 1)
    }
  }
  const queue = [...steps.map(s => s.id)].filter(id => indegree.get(id) === 0)
  queue.sort()
  const order: string[] = []
  while (queue.length > 0) {
    const id = queue.shift() as string
    order.push(id)
    const next: string[] = []
    for (const child of adjacency.get(id) ?? []) {
      indegree.set(child, (indegree.get(child) ?? 0) - 1)
      if (indegree.get(child) === 0) next.push(child)
    }
    next.sort()
    queue.push(...next)
  }
  if (order.length !== steps.length) {
    const cycle = steps.map(s => s.id).filter(id => !order.includes(id))
    return { cycle }
  }
  return { order }
}

export function validateWorkflow(spec: WorkflowSpec): WorkflowValidation {
  const errors: string[] = []
  const warnings: string[] = []

  if (!NAME_RE.test(spec.name)) {
    warnings.push(
      `name "${spec.name}" will be slugified to "${slugifyWorkflowName(spec.name)}"`,
    )
  }
  if (spec.steps.length === 0) {
    errors.push('workflow has no steps')
  }

  const seen = new Set<string>()
  for (const step of spec.steps) {
    if (seen.has(step.id)) errors.push(`duplicate step id "${step.id}"`)
    seen.add(step.id)
    if (!NAME_RE.test(step.id)) errors.push(`invalid step id "${step.id}"`)
    if (!step.prompt.trim()) warnings.push(`step "${step.id}" has an empty prompt`)
    if (step.allowedTools) {
      if (step.allowedTools.length === 0) {
        errors.push(`step "${step.id}" has an empty allowedTools list`)
      }
      const toolNames = new Set<string>()
      for (const tool of step.allowedTools) {
        if (!/^[A-Za-z][A-Za-z0-9_-]*(?:__[A-Za-z0-9_-]+)*$/.test(tool)) {
          errors.push(`step "${step.id}" has invalid allowed tool "${tool}"`)
        }
        if (toolNames.has(tool)) {
          errors.push(`step "${step.id}" repeats allowed tool "${tool}"`)
        }
        toolNames.add(tool)
      }
    }
    if (!KNOWN_AGENTS.includes(step.agent)) {
      warnings.push(
        `step "${step.id}" uses unknown agent "${step.agent}" (custom agents are allowed)`,
      )
    }
  }
  for (const step of spec.steps) {
    for (const dep of step.dependsOn ?? []) {
      if (!seen.has(dep)) {
        errors.push(`step "${step.id}" depends on missing step "${dep}"`)
      }
      if (dep === step.id) errors.push(`step "${step.id}" depends on itself`)
    }
  }

  let order: string[] = []
  if (errors.length === 0) {
    const result = topoOrder(spec.steps)
    if ('cycle' in result) {
      errors.push(`dependency cycle among: ${result.cycle.join(', ')}`)
    } else {
      order = result.order
    }
  }

  return { valid: errors.length === 0, errors, warnings, order }
}

const GATE_LABEL: Record<WorkflowGate, string> = {
  approval: 'human approval',
  verification: 'verification gate',
}

export function renderWorkflowMermaid(spec: WorkflowSpec): string {
  const lines = ['flowchart TD']
  const nodeById = new Map(
    spec.steps.map((step, index) => [step.id, `n${index}`]),
  )
  const escapeLabel = (value: string): string =>
    value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  for (const step of spec.steps) {
    const gate = step.gate ? `\\n⛓ ${GATE_LABEL[step.gate]}` : ''
    const check = step.checkpoint ? ' 💾' : ''
    lines.push(
      `  ${nodeById.get(step.id)}["${escapeLabel(step.name)}${check}\\n(${escapeLabel(step.agent)})${gate}"]`,
    )
  }
  for (const step of spec.steps) {
    const node = nodeById.get(step.id)
    const deps = step.dependsOn ?? []
    if (deps.length === 0) {
      lines.push(`  start((•)) --> ${node}`)
      continue
    }
    for (const dep of deps) {
      lines.push(`  ${nodeById.get(dep) ?? 'missing'} --> ${node}`)
    }
  }
  return lines.join('\n')
}

export function renderWorkflowAscii(spec: WorkflowSpec): string {
  const validation = validateWorkflow(spec)
  if (!validation.valid) {
    return `(cannot render: ${validation.errors.join('; ')})`
  }
  const depth = new Map<string, number>()
  const byId = new Map(spec.steps.map(step => [step.id, step]))
  for (const id of validation.order) {
    const step = byId.get(id)
    const deps = step?.dependsOn ?? []
    const d = deps.length === 0 ? 0 : Math.max(...deps.map(x => depth.get(x) ?? 0)) + 1
    depth.set(id, d)
  }
  const lines: string[] = []
  for (const id of validation.order) {
    const step = byId.get(id)
    if (!step) continue
    const indent = '  '.repeat(depth.get(id) ?? 0)
    const badges = [
      step.checkpoint ? 'checkpoint' : null,
      step.gate ? GATE_LABEL[step.gate] : null,
    ].filter(Boolean)
    const suffix = badges.length > 0 ? `  [${badges.join(', ')}]` : ''
    lines.push(`${indent}${depth.get(id) === 0 ? '●' : '└─▶'} ${step.name} (${step.agent})${suffix}`)
  }
  return lines.join('\n')
}

export function listWorkflows(cwd: string): string[] {
  const dir = workflowsDir(cwd)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(file => /\.(ya?ml|json)$/i.test(file))
    .map(file => file.replace(/\.(ya?ml|json)$/i, ''))
    .sort()
}

export function loadWorkflow(cwd: string, name: string): WorkflowSpec | null {
  const slug = slugifyWorkflowName(name)
  for (const ext of ['yaml', 'yml', 'json']) {
    const path = join(workflowsDir(cwd), `${slug}.${ext}`)
    if (existsSync(path)) {
      try {
        return parseWorkflowText(readFileSync(path, 'utf-8'))
      } catch {
        return null
      }
    }
  }
  return null
}

export function saveWorkflow(
  cwd: string,
  spec: WorkflowSpec,
  options: { force?: boolean } = {},
): { path: string; created: boolean } {
  const path = workflowPath(cwd, spec.name)
  mkdirSync(workflowsDir(cwd), { recursive: true })
  if (existsSync(path) && options.force !== true) {
    return { path, created: false }
  }
  writeFileSync(path, `${stringifyYaml(spec)}`)
  return { path, created: true }
}

export function loadRunState(cwd: string, name: string): RunState | null {
  const path = statePath(cwd, name)
  if (!existsSync(path)) return null
  const text = readPrivateText(stateDir(cwd), path, MAX_RUN_STATE_BYTES)
  if (text == null) return null
  const parsed = safeParseJSON(text, false)
  if (!parsed || typeof parsed !== 'object') return null
  const candidate = parsed as Partial<RunState>
  if (!Array.isArray(candidate.completed)) return null
  const completed = candidate.completed.filter(
    (value): value is string => typeof value === 'string',
  )
  const suppliedOutputs =
    candidate.outputs != null &&
    typeof candidate.outputs === 'object' &&
    !Array.isArray(candidate.outputs)
      ? Object.fromEntries(
          Object.entries(candidate.outputs).filter(
            (entry): entry is [string, string] =>
              typeof entry[1] === 'string',
          ),
        )
      : undefined
  const boundedOutputs = boundRunOutputs(completed, suppliedOutputs)
  // Optional fields keep existing v1 state files valid while new runs gain
  // explicit gate and semantic-checkpoint state.
  return {
    version: 1,
    name:
      typeof candidate.name === 'string'
        ? candidate.name
        : slugifyWorkflowName(name),
    startedAt:
      typeof candidate.startedAt === 'string'
        ? candidate.startedAt
        : new Date().toISOString(),
    updatedAt:
      typeof candidate.updatedAt === 'string'
        ? candidate.updatedAt
        : new Date().toISOString(),
    completed,
    ...boundedOutputs,
    ...(Array.isArray(candidate.approved)
      ? {
          approved: candidate.approved.filter(
            (value): value is string => typeof value === 'string',
          ),
        }
      : {}),
    ...(typeof candidate.awaitingApproval === 'string'
      ? { awaitingApproval: candidate.awaitingApproval }
      : {}),
    ...(Array.isArray(candidate.checkpoints)
      ? {
          checkpoints: candidate.checkpoints.filter(
            checkpoint =>
              checkpoint != null &&
              typeof checkpoint === 'object' &&
              typeof checkpoint.stepId === 'string' &&
              Array.isArray(checkpoint.completed) &&
              typeof checkpoint.createdAt === 'string',
          ),
        }
      : {}),
    ...(candidate.status === 'running' ||
    candidate.status === 'held' ||
    candidate.status === 'completed' ||
    candidate.status === 'failed'
      ? { status: candidate.status }
      : {}),
  }
}

function createRunState(name: string, now = new Date().toISOString()): RunState {
  return {
    version: 1,
    name: slugifyWorkflowName(name),
    startedAt: now,
    updatedAt: now,
    completed: [],
    outputs: {},
    unavailableOutputs: [],
    approved: [],
    checkpoints: [],
    status: 'running',
  }
}

function writeRunStateUnlocked(
  cwd: string,
  name: string,
  state: RunState,
): RunState {
  state.updatedAt = new Date().toISOString()
  writePrivateTextAtomic(
    stateDir(cwd),
    statePath(cwd, name),
    `${JSON.stringify(state, null, 2)}\n`,
    MAX_RUN_STATE_BYTES,
  )
  return state
}

function updateRunState(
  cwd: string,
  name: string,
  update: (state: RunState) => void,
): RunState {
  return withRunStateLock(cwd, name, () => {
    const state = loadRunState(cwd, name) ?? createRunState(name)
    update(state)
    return writeRunStateUnlocked(cwd, name, state)
  })
}

export function markStepComplete(
  cwd: string,
  name: string,
  stepId: string,
): RunState {
  return updateRunState(cwd, name, state => {
    if (!state.completed.includes(stepId)) state.completed.push(stepId)
    Object.assign(state, boundRunOutputs(state.completed, state.outputs))
    state.status = 'running'
  })
}

/** Replace crash-recovery progress with the executor's authoritative snapshot. */
export function setRunCompleted(
  cwd: string,
  name: string,
  completed: string[],
  outputs?: Readonly<Record<string, string>>,
): RunState {
  return updateRunState(cwd, name, state => {
    state.completed = [...new Set(completed)]
    Object.assign(
      state,
      boundRunOutputs(state.completed, outputs ?? state.outputs),
    )
    state.status = 'running'
  })
}

/** Record an explicitly configured semantic checkpoint. */
export function markRunCheckpoint(
  cwd: string,
  name: string,
  stepId: string,
  completed: string[],
): RunState {
  return updateRunState(cwd, name, state => {
    const checkpoints = state.checkpoints ?? []
    const checkpoint = {
      stepId,
      completed: [...new Set(completed)],
      createdAt: new Date().toISOString(),
    }
    const prior = checkpoints.findIndex(entry => entry.stepId === stepId)
    if (prior >= 0) checkpoints[prior] = checkpoint
    else checkpoints.push(checkpoint)
    state.checkpoints = checkpoints
  })
}

/** Persist a pre-execution approval hold. */
export function markStepAwaitingApproval(
  cwd: string,
  name: string,
  stepId: string,
): RunState {
  return updateRunState(cwd, name, state => {
    state.awaitingApproval = stepId
    state.status = 'held'
  })
}

/**
 * Approve only the gate that a prior run actually held on. This prevents
 * speculative approval of a later side effect before its dependencies run.
 */
export function approveWorkflowStep(
  cwd: string,
  name: string,
  stepId: string,
): RunState {
  return updateRunState(cwd, name, next => {
    if (next.awaitingApproval !== stepId) {
      throw new Error(
        `Workflow ${name} is not awaiting approval for step "${stepId}"`,
      )
    }
    next.approved = [...new Set([...(next.approved ?? []), stepId])]
    delete next.awaitingApproval
    next.status = 'running'
  })
}

/**
 * Consume a persisted approval immediately before execution. A crash or failed
 * attempt therefore cannot replay a side effect under a stale approval.
 */
export function consumeWorkflowApproval(
  cwd: string,
  name: string,
  stepId: string,
): boolean {
  let consumed = false
  updateRunState(cwd, name, next => {
    if (!next.approved?.includes(stepId)) return
    next.approved = (next.approved ?? []).filter(id => id !== stepId)
    delete next.awaitingApproval
    next.status = 'running'
    consumed = true
  })
  return consumed
}

export function markRunStatus(
  cwd: string,
  name: string,
  status: NonNullable<RunState['status']>,
): RunState {
  return updateRunState(cwd, name, state => {
    state.status = status
    if (status === 'completed' || status === 'failed') {
      delete state.awaitingApproval
    }
  })
}

export function resetRunState(cwd: string, name: string): RunState {
  return withRunStateLock(cwd, name, () =>
    writeRunStateUnlocked(cwd, name, createRunState(name)),
  )
}

export function buildRunPlan(spec: WorkflowSpec, state?: RunState | null): RunPlan {
  const validation = validateWorkflow(spec)
  const done = new Set(
    normalizeWorkflowCompleted(spec, state?.completed ?? []),
  )
  const byId = new Map(spec.steps.map(step => [step.id, step]))
  const order = validation.valid
    ? validation.order
    : spec.steps.map(step => step.id)

  const steps: RunPlanStep[] = []
  let nextStepId: string | null = null
  for (const id of order) {
    const step = byId.get(id)
    if (!step) continue
    const deps = step.dependsOn ?? []
    let status: RunStepStatus
    if (done.has(id)) {
      status = 'done'
    } else if (state?.awaitingApproval === id) {
      status = 'held'
    } else if (deps.every(dep => done.has(dep))) {
      status = 'ready'
      if (nextStepId === null) nextStepId = id
    } else {
      status = 'blocked'
    }
    steps.push({
      id,
      name: step.name,
      agent: step.agent,
      status,
      dependsOn: deps,
      gate: step.gate,
      checkpoint: step.checkpoint === true,
    })
  }

  return {
    name: spec.name,
    total: steps.length,
    completed: steps.filter(step => step.status === 'done').length,
    steps,
    nextStepId,
  }
}

/**
 * Keep only known completed steps whose full dependency closure is complete.
 *
 * Run-state files are crash-recovery input, not authority to skip prerequisites.
 * This also repairs legacy/manual states that marked a downstream step first.
 */
export function normalizeWorkflowCompleted(
  spec: WorkflowSpec,
  completed: readonly string[],
): string[] {
  const validation = validateWorkflow(spec)
  if (!validation.valid) return []
  const requested = new Set(completed)
  const accepted = new Set<string>()
  const byId = new Map(spec.steps.map(step => [step.id, step]))
  for (const id of validation.order) {
    const step = byId.get(id)
    if (
      step &&
      requested.has(id) &&
      (step.dependsOn ?? []).every(dependency => accepted.has(dependency))
    ) {
      accepted.add(id)
    }
  }
  return validation.order.filter(id => accepted.has(id))
}

export function formatValidation(
  spec: WorkflowSpec,
  validation: WorkflowValidation,
): string {
  const lines = [
    `Workflow: ${spec.name} (${spec.steps.length} steps)`,
    validation.valid ? 'Valid: yes' : 'Valid: no',
  ]
  if (validation.errors.length > 0) {
    lines.push('Errors:')
    for (const error of validation.errors) lines.push(`  - ${error}`)
  }
  if (validation.warnings.length > 0) {
    lines.push('Warnings:')
    for (const warning of validation.warnings) lines.push(`  - ${warning}`)
  }
  if (validation.valid) {
    lines.push(`Order: ${validation.order.join(' -> ')}`)
  }
  return lines.join('\n')
}

export function formatRunPlan(plan: RunPlan): string {
  const marker: Record<RunStepStatus, string> = {
    done: '[x]',
    ready: '[ ]',
    blocked: '[·]',
    held: '[!]',
  }
  const lines = [
    `Run plan: ${plan.name} (${plan.completed}/${plan.total} complete)`,
    '',
  ]
  for (const step of plan.steps) {
    const badges = [
      step.gate ? GATE_LABEL[step.gate] : null,
      step.checkpoint ? 'checkpoint' : null,
    ].filter(Boolean)
    const suffix = badges.length > 0 ? `  [${badges.join(', ')}]` : ''
    const deps = step.dependsOn.length > 0 ? ` ← ${step.dependsOn.join(', ')}` : ''
    lines.push(`${marker[step.status]} ${step.id}: ${step.name} (${step.agent})${deps}${suffix}`)
  }
  lines.push('')
  lines.push(
    plan.nextStepId
      ? `Next ready step: ${plan.nextStepId}`
      : plan.completed === plan.total
        ? 'All steps complete.'
        : 'No ready step (blocked on gates or cycle).',
  )
  return lines.join('\n')
}
