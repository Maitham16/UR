/**
 * Headless agent crew.
 *
 * The non-interactive, scriptable counterpart to UR's in-session swarm/teammate
 * system. A crew is a shared task board (`.ur/crew/<name>.json`): a lead
 * decomposes a goal into subtasks, then one or more workers atomically *claim*
 * the next open task and run it as a headless `ur -p` subagent — optionally each
 * in its own git worktree so their edits don't collide. State is plain JSON so a
 * run can be inspected, resumed, or committed. This is UR's local-first take on
 * the 2026 "agent teams / lead+worker over a shared task file with worktrees"
 * pattern. Decomposition and claiming are deterministic and unit-testable; the
 * actual model spawning lives behind the injected step runner (see cliStepRunner).
 */

import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { safeParseJSON } from '../../utils/json.js'
import { lockSync } from '../../utils/lockfile.js'
import { makeCliStepRunner, makeDryRunner } from './cliStepRunner.js'
import type { StepRunner, Verdict } from './executor.js'
import type { WorkflowStep } from './workflows.js'
import type { DecomposedTask } from './decomposer.js'
import { recordOutcomes } from './learning.js'
import { isClearlyReadOnlyWork } from './parallelPolicy.js'

export type CrewTaskStatus = 'todo' | 'claimed' | 'done' | 'failed' | 'blocked'

export type CrewAttemptIsolation = 'shared' | 'worktree' | 'dry-run'

export type CrewTask = {
  id: string
  title: string
  prompt: string
  status: CrewTaskStatus
  /** Task ids that must be done before this task can be claimed. */
  dependsOn?: string[]
  assignee?: string
  worktree?: string
  /** Number of times a worker process has been started for this task. */
  attempts?: number
  /** Isolation used by the most recent attempt. */
  attemptIsolation?: CrewAttemptIsolation
  lastError?: string
  result?: string
  verdict?: Verdict | null
  claimedAt?: string
  finishedAt?: string
  filesTouched?: string[]
  risk?: 'low' | 'medium' | 'high'
  testsRequired?: string[]
  rollbackPoint?: string
}

export type CrewSpec = {
  version: 1
  name: string
  goal: string
  lead: string
  createdAt: string
  updatedAt: string
  tasks: CrewTask[]
}

function isCrewTaskReadOnly(task: CrewTask): boolean {
  return isClearlyReadOnlyWork(task.title)
}

export function crewDir(cwd: string): string {
  return join(cwd, '.ur', 'crew')
}

export function sanitizeCrewName(name: string): string {
  const normalized = name.trim().replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-')
  if (!normalized) return 'crew'
  if (normalized.length <= 80) return normalized
  const suffix = createHash('sha256').update(normalized).digest('hex').slice(0, 10)
  return `${normalized.slice(0, 69)}-${suffix}`
}

export function crewPath(cwd: string, name: string): string {
  return join(crewDir(cwd), `${sanitizeCrewName(name)}.json`)
}

function isCrewSpec(value: unknown): value is CrewSpec {
  return (
    !!value &&
    typeof value === 'object' &&
    Array.isArray((value as CrewSpec).tasks) &&
    typeof (value as CrewSpec).goal === 'string'
  )
}

export function listCrews(cwd: string): CrewSpec[] {
  const dir = crewDir(cwd)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(file => file.endsWith('.json'))
    .map(file => safeParseJSON(readFileSync(join(dir, file), 'utf-8'), false))
    .filter(isCrewSpec)
}

export function loadCrew(cwd: string, name: string): CrewSpec | null {
  const path = crewPath(cwd, name)
  if (!existsSync(path)) return null
  const parsed = safeParseJSON(readFileSync(path, 'utf-8'), false)
  return isCrewSpec(parsed) ? parsed : null
}

const crewLockWaitArray = new Int32Array(new SharedArrayBuffer(4))

function crewLockPath(cwd: string, name: string): string {
  return join(crewDir(cwd), `${sanitizeCrewName(name)}.mutation-lock`)
}

function acquireCrewLock(cwd: string, name: string): () => void {
  mkdirSync(crewDir(cwd), { recursive: true })
  const path = crewLockPath(cwd, name)
  writeFileSync(path, '', { flag: 'a', mode: 0o600 })
  let lastError: unknown
  for (let attempt = 0; attempt < 21; attempt++) {
    try {
      return lockSync(path, { realpath: false, stale: 30_000 })
    } catch (error) {
      lastError = error
      if (
        (error as NodeJS.ErrnoException).code !== 'ELOCKED' ||
        attempt === 20
      ) {
        throw error
      }
      Atomics.wait(crewLockWaitArray, 0, 0, Math.min(100, 10 + attempt * 5))
    }
  }
  throw lastError
}

function withCrewLock<T>(cwd: string, name: string, operation: () => T): T {
  const release = acquireCrewLock(cwd, name)
  try {
    return operation()
  } finally {
    release()
  }
}

function writeCrew(cwd: string, spec: CrewSpec): void {
  mkdirSync(crewDir(cwd), { recursive: true })
  const destination = crewPath(cwd, spec.name)
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(spec, null, 2)}\n`, {
      mode: 0o600,
    })
    renameSync(temporary, destination)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

export function saveCrew(cwd: string, spec: CrewSpec): void {
  withCrewLock(cwd, spec.name, () => writeCrew(cwd, spec))
}

export function deleteCrew(cwd: string, name: string): boolean {
  return withCrewLock(cwd, name, () => {
    const path = crewPath(cwd, name)
    if (!existsSync(path)) return false
    unlinkSync(path)
    return true
  })
}

/**
 * Decompose a free-text goal into subtasks. Deterministic: prefers an explicit
 * numbered list, then bullet points, then newlines, then sentence-level
 * conjunctions ("and"/"then"). Falls back to a single task when no structure is
 * found, so the lead never invents work that wasn't asked for.
 */
export function decomposeGoal(goal: string): string[] {
  // The CLI arg round-trip can turn real newlines into a literal "\n"; normalize
  // so a multi-line goal pasted through a flag still decomposes correctly.
  const clean = goal.replace(/\\n/g, '\n').trim()
  if (!clean) return []

  // Numbered list, whether newline- or inline-separated ("1. a 2. b 3. c").
  const numberMatches = clean.match(/\b\d+[.)]\s+/g)
  if (numberMatches && numberMatches.length >= 2) {
    const parts = clean.split(/\s*\b\d+[.)]\s+/).map(part => part.trim()).filter(Boolean)
    if (parts.length >= 2) return parts
  }

  // Bullet list.
  const bulletMatches = clean.match(/(?:^|\n)\s*[-*]\s+/g)
  if (bulletMatches && bulletMatches.length >= 2) {
    const parts = clean.split(/(?:^|\n)\s*[-*]\s+/).map(part => part.trim()).filter(Boolean)
    if (parts.length >= 2) return parts
  }

  // Distinct lines.
  const lines = clean.split('\n').map(line => line.trim()).filter(Boolean)
  if (lines.length >= 2) return lines

  // Sentence-level conjunctions ("write the parser and then add tests").
  const byConjunction = clean
    .split(/\s*(?:,?\s+(?:and then|then|and)\s+)\s*/i)
    .map(part => part.trim())
    .filter(Boolean)
  if (byConjunction.length >= 2 && byConjunction.length <= 6) return byConjunction

  return [clean]
}

function makeTask(index: number, instruction: string, goal: string): CrewTask {
  const title = instruction.length > 72 ? `${instruction.slice(0, 69)}...` : instruction
  return {
    id: `t${index + 1}`,
    title,
    prompt: `Overall goal: ${goal}\n\nYour subtask: ${instruction}\n\nComplete only this subtask. End your reply with VERDICT: PASS if you finished it, or VERDICT: FAIL if you could not.`,
    status: 'todo',
  }
}

function makeTaskFromDecomposed(task: DecomposedTask, goal: string): CrewTask {
  const title = task.goal.length > 72 ? `${task.goal.slice(0, 69)}...` : task.goal
  const dependencies = task.dependsOn?.length
    ? `\nDepends on: ${task.dependsOn.join(', ')}\nDependency outputs:\n{{prior}}`
    : ''
  const files = task.filesTouched.length ? `\nFiles touched: ${task.filesTouched.join(', ')}` : ''
  const risk = `\nRisk level: ${task.risk}`
  const tests = `\nTests required: ${task.testsRequired.join(', ')}`
  const rollback = `\nRollback point: ${task.rollbackPoint}`
  return {
    id: task.id,
    title,
    prompt: `Overall goal: ${goal}\n\nYour subtask: ${task.goal}${dependencies}${files}${risk}${tests}${rollback}\n\nComplete only this subtask. End your reply with VERDICT: PASS if you finished it, or VERDICT: FAIL if you could not.`,
    status: 'todo',
    dependsOn: task.dependsOn,
    filesTouched: task.filesTouched,
    risk: task.risk,
    testsRequired: task.testsRequired,
    rollbackPoint: task.rollbackPoint,
  }
}

export function createCrew(
  cwd: string,
  name: string,
  goal: string,
  options: { lead?: string; tasks?: string[]; decomposed?: DecomposedTask[] } = {},
): CrewSpec {
  const now = new Date().toISOString()
  let tasks: CrewTask[]
  if (options.decomposed && options.decomposed.length > 0) {
    tasks = options.decomposed.map(task => makeTaskFromDecomposed(task, goal))
  } else {
    const instructions = options.tasks && options.tasks.length > 0 ? options.tasks : decomposeGoal(goal)
    tasks = instructions.map((instruction, index) => makeTask(index, instruction, goal))
  }
  const spec: CrewSpec = {
    version: 1,
    name: sanitizeCrewName(name),
    goal: goal.trim(),
    lead: options.lead ?? 'general-purpose',
    createdAt: now,
    updatedAt: now,
    tasks,
  }
  saveCrew(cwd, spec)
  return spec
}

export function addCrewTask(cwd: string, name: string, instruction: string): CrewSpec | null {
  return withCrewLock(cwd, name, () => {
    const spec = loadCrew(cwd, name)
    if (!spec) return null
    const task = makeTask(spec.tasks.length, instruction, spec.goal)
    const updated: CrewSpec = {
      ...spec,
      updatedAt: new Date().toISOString(),
      tasks: [...spec.tasks, task],
    }
    writeCrew(cwd, updated)
    return updated
  })
}

/**
 * Claim the next dependency-ready task. The exported wrapper holds a
 * cross-process board lock around this read-modify-write transaction.
 */
function claimNextTaskUnlocked(
  cwd: string,
  name: string,
  worker: string,
  maxAttempts = Number.MAX_SAFE_INTEGER,
  policy: {
    serializeSharedMutations?: boolean
    isolatedWrites?: boolean
  } = {},
): CrewTask | null {
  const spec = loadCrew(cwd, name)
  if (!spec) return null

  const byId = new Map(spec.tasks.map(task => [task.id, task]))
  let boardChanged = false
  const now = new Date().toISOString()
  for (const candidate of spec.tasks) {
    if (
      candidate.status === 'todo' &&
      (candidate.attempts ?? 0) >= maxAttempts
    ) {
      candidate.status = 'failed'
      candidate.finishedAt = now
      candidate.lastError = `Exhausted the ${maxAttempts}-attempt limit.`
      candidate.result = candidate.lastError
      candidate.verdict = 'FAIL'
      boardChanged = true
    }
  }
  let changed = true
  while (changed) {
    changed = false
    for (const candidate of spec.tasks) {
      if (candidate.status !== 'todo') continue
      const badDependency = (candidate.dependsOn ?? []).find(dep => {
        const dependency = byId.get(dep)
        return !dependency || dependency.status === 'failed' || dependency.status === 'blocked'
      })
      if (!badDependency) continue
      candidate.status = 'blocked'
      candidate.finishedAt = new Date().toISOString()
      candidate.result = byId.has(badDependency)
        ? `Blocked because dependency ${badDependency} did not complete successfully.`
        : `Blocked because dependency ${badDependency} does not exist.`
      changed = true
      boardChanged = true
    }
  }

  const activeClaims = spec.tasks.filter(item => item.status === 'claimed')
  const task = spec.tasks.find(
    item =>
      item.status === 'todo' &&
      (item.dependsOn ?? []).every(dep => byId.get(dep)?.status === 'done') &&
      (!policy.serializeSharedMutations ||
        policy.isolatedWrites ||
        activeClaims.every(
          active =>
            isCrewTaskReadOnly(item) && isCrewTaskReadOnly(active),
        )),
  )

  // No claimed prerequisite and no runnable task means the remaining dependency
  // graph is cyclic. Make that terminal instead of spinning worker waves forever.
  if (!task && !spec.tasks.some(item => item.status === 'claimed')) {
    const stranded = spec.tasks.filter(item => item.status === 'todo')
    if (stranded.length > 0) {
      const now = new Date().toISOString()
      for (const candidate of stranded) {
        candidate.status = 'blocked'
        candidate.finishedAt = now
        candidate.result = 'Blocked by a cyclic or otherwise unresolvable dependency graph.'
      }
      spec.updatedAt = now
      writeCrew(cwd, spec)
      return null
    }
  }

  if (boardChanged) {
    spec.updatedAt = new Date().toISOString()
    writeCrew(cwd, spec)
  }
  if (!task) return null
  task.status = 'claimed'
  task.assignee = worker
  task.attempts = (task.attempts ?? 0) + 1
  task.attemptIsolation = undefined
  task.worktree = undefined
  task.lastError = undefined
  task.claimedAt = new Date().toISOString()
  spec.updatedAt = task.claimedAt
  writeCrew(cwd, spec)
  return task
}

export function claimNextTask(
  cwd: string,
  name: string,
  worker: string,
  maxAttempts = Number.MAX_SAFE_INTEGER,
  policy: {
    serializeSharedMutations?: boolean
    isolatedWrites?: boolean
  } = {},
): CrewTask | null {
  return withCrewLock(cwd, name, () =>
    claimNextTaskUnlocked(cwd, name, worker, maxAttempts, policy),
  )
}

function completeTaskUnlocked(
  cwd: string,
  name: string,
  taskId: string,
  result: {
    status: 'done' | 'failed'
    output?: string
    verdict?: Verdict | null
    worktree?: string
    error?: string
  },
): CrewSpec | null {
  const spec = loadCrew(cwd, name)
  if (!spec) return null
  const task = spec.tasks.find(item => item.id === taskId)
  if (!task) return null
  task.status = result.status
  task.result = result.output?.slice(0, 2000)
  task.verdict = result.verdict ?? null
  task.lastError = result.status === 'failed'
    ? (result.error ?? result.output)?.slice(0, 1000)
    : undefined
  if (result.worktree) task.worktree = result.worktree
  task.finishedAt = new Date().toISOString()
  spec.updatedAt = task.finishedAt
  writeCrew(cwd, spec)
  return spec
}

export function completeTask(
  cwd: string,
  name: string,
  taskId: string,
  result: {
    status: 'done' | 'failed'
    output?: string
    verdict?: Verdict | null
    worktree?: string
    error?: string
  },
): CrewSpec | null {
  return withCrewLock(cwd, name, () =>
    completeTaskUnlocked(cwd, name, taskId, result),
  )
}

/** Reset orphaned `claimed` tasks (from a crashed run) back to `todo`. */
export function reopenClaimed(cwd: string, name: string): CrewSpec | null {
  return withCrewLock(cwd, name, () => {
    const spec = loadCrew(cwd, name)
    if (!spec) return null
    let changed = false
    for (const task of spec.tasks) {
      if (task.status === 'claimed') {
        task.status = 'todo'
        task.assignee = undefined
        task.claimedAt = undefined
        task.attemptIsolation = undefined
        task.worktree = undefined
        changed = true
      }
    }
    if (changed) {
      spec.updatedAt = new Date().toISOString()
      writeCrew(cwd, spec)
    }
    return spec
  })
}

export type CrewProgress = {
  total: number
  done: number
  failed: number
  blocked: number
  todo: number
  claimed: number
}

export function crewProgress(spec: CrewSpec): CrewProgress {
  return {
    total: spec.tasks.length,
    done: spec.tasks.filter(t => t.status === 'done').length,
    failed: spec.tasks.filter(t => t.status === 'failed').length,
    blocked: spec.tasks.filter(t => t.status === 'blocked').length,
    todo: spec.tasks.filter(t => t.status === 'todo').length,
    claimed: spec.tasks.filter(t => t.status === 'claimed').length,
  }
}

function taskToStep(task: CrewTask, lead: string): WorkflowStep {
  return {
    id: task.id,
    name: task.title,
    agent: lead,
    prompt: task.prompt,
    dependsOn: task.dependsOn,
  }
}

function isolatedTaskToStep(task: CrewTask, lead: string): WorkflowStep {
  const step = taskToStep(task, lead)
  return {
    ...step,
    prompt:
      `${step.prompt}\n\nThis attempt runs in an isolated git worktree. ` +
      'Do not push, publish, deploy, send messages, or perform other external mutations. ' +
      'Leave code changes in this worktree for the lead to review and integrate.',
  }
}

/** Create a fresh git worktree for one task attempt. */
async function ensureWorktree(
  cwd: string,
  crew: string,
  attemptId: string,
): Promise<string | null> {
  const normalizedAttemptId = attemptId.replace(/[^a-zA-Z0-9_-]/g, '-')
  const attemptHash = createHash('sha256').update(attemptId).digest('hex').slice(0, 10)
  const safeAttemptId = `${normalizedAttemptId.slice(0, 96)}-${attemptHash}`
  const path = join(crewDir(cwd), '.worktrees', `${crew}-${safeAttemptId}`)
  const branch = `ur/crew/${crew}/${safeAttemptId}`
  if (existsSync(path)) return path
  mkdirSync(join(crewDir(cwd), '.worktrees'), { recursive: true })
  const result = await execFileNoThrowWithCwd(
    'git',
    ['worktree', 'add', '-b', branch, path],
    { cwd, timeout: 60_000, preserveOutputOnError: true },
  )
  return result.code === 0 ? path : null
}

export type RunCrewOptions = {
  cwd: string
  workers?: number
  dryRun?: boolean
  worktrees?: boolean
  resume?: boolean
  maxTurns?: number
  skipPermissions?: boolean
  onEvent?: (event: CrewEvent) => void
  /** Injectable runner override (tests). When set, worktrees are ignored. */
  runnerFor?: (workerCwd: string) => StepRunner
  /**
   * Dynamic fan-out: keep spawning workers while unclaimed tasks remain
   * (tasks may be appended to the board mid-run), governed by maxWorkers.
   */
  dynamic?: boolean
  /** Resource governor for dynamic mode (default 8, hard cap 32). */
  maxWorkers?: number
  /**
   * Maximum process starts for one task, including the first attempt. Clamped
   * to 1..5. Automatic retries require dry-run mode, a fresh worktree per
   * attempt, or an injected runner whose caller explicitly sets retrySafe.
   */
  maxAttempts?: number
  /** Base exponential retry delay in milliseconds (default 250, max 30s). */
  retryBackoffMs?: number
  /** Cooperative cancellation: no new task or retry starts after abort. */
  signal?: AbortSignal
  /**
   * Tests and embedding callers may attest that runnerFor rolls back or is
   * idempotent. Never set this for an agent mutating the shared workspace.
   */
  retrySafe?: boolean
}

export type CrewEvent =
  | { kind: 'claim'; worker: string; taskId: string; title: string; attempt: number }
  | {
      kind: 'retry'
      worker: string
      taskId: string
      attempt: number
      delayMs: number
      reason: string
    }
  | { kind: 'retry-skipped'; worker: string; taskId: string; reason: string }
  | { kind: 'cancelled'; worker: string; taskId?: string }
  | {
      kind: 'done'
      worker: string
      taskId: string
      status: 'done' | 'failed'
      verdict?: Verdict | null
      attempts: number
    }
  | { kind: 'worker-exit'; worker: string; handled: number }

export type RunCrewResult = {
  name: string
  workers: number
  progress: CrewProgress
  handled: Array<{
    worker: string
    taskId: string
    status: 'done' | 'failed'
    attempts: number
  }>
}

function updateClaimedTask(
  cwd: string,
  name: string,
  taskId: string,
  update: (task: CrewTask) => void,
): CrewTask | null {
  return withCrewLock(cwd, name, () => {
    const spec = loadCrew(cwd, name)
    if (!spec) return null
    const task = spec.tasks.find(item => item.id === taskId && item.status === 'claimed')
    if (!task) return null
    update(task)
    spec.updatedAt = new Date().toISOString()
    writeCrew(cwd, spec)
    return task
  })
}

function beginRetry(cwd: string, name: string, taskId: string, worker: string): CrewTask | null {
  return updateClaimedTask(cwd, name, taskId, task => {
    task.assignee = worker
    task.attempts = (task.attempts ?? 1) + 1
    task.claimedAt = new Date().toISOString()
    task.attemptIsolation = undefined
    task.worktree = undefined
    task.lastError = undefined
  })
}

/**
 * Recover tasks left claimed by a dead scheduler without replaying an agent
 * that may already have changed the shared workspace. Only isolated attempts
 * can be safely started again; ambiguous shared attempts become terminal.
 */
function recoverClaimedSafely(cwd: string, name: string, maxAttempts: number): CrewSpec | null {
  return withCrewLock(cwd, name, () => {
    const spec = loadCrew(cwd, name)
    if (!spec) return null
    let changed = false
    const now = new Date().toISOString()
    for (const task of spec.tasks) {
      if (task.status !== 'claimed') continue
      const isolated =
        task.attemptIsolation === 'worktree' || task.attemptIsolation === 'dry-run'
      if (isolated && (task.attempts ?? 1) < maxAttempts) {
        task.status = 'todo'
        task.assignee = undefined
        task.claimedAt = undefined
        task.attemptIsolation = undefined
        task.worktree = undefined
        task.lastError = 'Previous isolated worker exited before reporting completion.'
      } else {
        task.status = 'failed'
        task.finishedAt = now
        task.lastError = isolated
          ? `Previous worker exited and exhausted the ${maxAttempts}-attempt limit.`
          : 'Previous worker exited after a shared-workspace attempt; automatic replay was refused because mutations may be ambiguous.'
        task.result = task.lastError
        task.verdict = 'FAIL'
      }
      changed = true
    }
    if (changed) {
      spec.updatedAt = now
      writeCrew(cwd, spec)
    }
    return spec
  })
}

function priorOutputsForTask(cwd: string, name: string, task: CrewTask): Record<string, string> {
  const spec = loadCrew(cwd, name)
  if (!spec) return {}
  const byId = new Map(spec.tasks.map(item => [item.id, item]))
  const outputs: Record<string, string> = {}
  for (const dependency of task.dependsOn ?? []) {
    const result = byId.get(dependency)?.result
    if (result !== undefined) outputs[dependency] = result
  }
  return outputs
}

async function retryDelay(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return false
  if (ms <= 0) return true
  return await new Promise(resolve => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve(true)
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve(false)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function runCrew(name: string, options: RunCrewOptions): Promise<RunCrewResult> {
  const cwd = options.cwd
  const baseSpec = loadCrew(cwd, name)
  if (!baseSpec) throw new Error(`Crew not found: ${name}`)

  const boundedInteger = (
    value: number | undefined,
    fallback: number,
    minimum: number,
    maximum: number,
  ): number => {
    if (value === undefined || !Number.isFinite(value)) return fallback
    return Math.min(maximum, Math.max(minimum, Math.floor(value)))
  }
  const workerCount = boundedInteger(options.workers, 1, 1, 32)
  const maxAttempts = boundedInteger(options.maxAttempts, 2, 1, 5)
  const retryBackoffMs = boundedInteger(options.retryBackoffMs, 250, 0, 30_000)
  recoverClaimedSafely(cwd, name, maxAttempts)

  const lead = baseSpec.lead
  const handled: RunCrewResult['handled'] = []
  const retryIsSafe =
    options.dryRun === true ||
    (options.worktrees === true && !options.runnerFor) ||
    (options.runnerFor !== undefined && options.retrySafe === true)

  const makeRunner = (workerCwd: string): StepRunner => {
    if (options.runnerFor) return options.runnerFor(workerCwd)
    return options.dryRun
      ? makeDryRunner()
      : makeCliStepRunner({
          cwd: workerCwd,
          maxTurns: options.maxTurns,
          skipPermissions: options.skipPermissions,
        })
  }

  async function worker(workerId: string): Promise<number> {
    let count = 0
    let cancellationEmitted = false

    while (!options.signal?.aborted) {
      let task = claimNextTask(cwd, name, workerId, maxAttempts, {
        serializeSharedMutations: true,
        isolatedWrites:
          options.dryRun === true ||
          (options.worktrees === true && !options.runnerFor),
      })
      if (!task) break
      options.onEvent?.({
        kind: 'claim',
        worker: workerId,
        taskId: task.id,
        title: task.title,
        attempt: task.attempts ?? 1,
      })

      for (;;) {
        const attempt = task.attempts ?? 1
        if (options.signal?.aborted) {
          completeTask(cwd, name, task.id, {
            status: 'failed',
            output: 'Cancelled before the worker attempt started.',
            verdict: 'FAIL',
            error: 'Crew run cancelled.',
          })
          handled.push({ worker: workerId, taskId: task.id, status: 'failed', attempts: attempt })
          options.onEvent?.({ kind: 'cancelled', worker: workerId, taskId: task.id })
          cancellationEmitted = true
          count += 1
          break
        }

        let workerCwd = cwd
        let setupError: string | undefined
        let isolation: CrewAttemptIsolation = options.dryRun ? 'dry-run' : 'shared'
        if (options.worktrees && !options.dryRun && !options.runnerFor) {
          const attemptId = `${baseSpec.createdAt}-${task.id}-a${attempt}`
          const worktree = await ensureWorktree(cwd, name, attemptId)
          if (worktree) {
            workerCwd = worktree
            isolation = 'worktree'
          } else {
            setupError = `Could not create isolated worktree for ${task.id} attempt ${attempt}.`
          }
        }

        updateClaimedTask(cwd, name, task.id, current => {
          current.attemptIsolation = isolation
          current.worktree = workerCwd === cwd ? undefined : workerCwd
        })

        let output = ''
        let verdict: Verdict | null | undefined = 'FAIL'
        let isError = true
        let failureReason = setupError
        if (!setupError) {
          try {
            // A new runner means a new child-agent process for every retry.
            const runner = makeRunner(workerCwd)
            const out = await runner({
              step: isolation === 'worktree'
                ? isolatedTaskToStep(task, lead)
                : taskToStep(task, lead),
              iteration: attempt,
              priorOutputs: priorOutputsForTask(cwd, name, task),
            })
            output = out.output
            verdict = out.verdict
            isError = out.isError === true
            if (isError || verdict === 'FAIL') {
              failureReason = output || `Worker returned ${verdict ?? 'an error'}.`
            }
          } catch (error) {
            failureReason = error instanceof Error ? error.message : String(error)
            output = `Worker process crashed: ${failureReason}`
          }
        } else {
          output = setupError
        }

        const status: 'done' | 'failed' =
          isError || verdict === 'FAIL' ? 'failed' : 'done'
        if (status === 'done') {
          completeTask(cwd, name, task.id, {
            status,
            output,
            verdict,
            worktree: workerCwd === cwd ? undefined : workerCwd,
          })
          handled.push({ worker: workerId, taskId: task.id, status, attempts: attempt })
          options.onEvent?.({
            kind: 'done',
            worker: workerId,
            taskId: task.id,
            status,
            verdict,
            attempts: attempt,
          })
          count += 1
          break
        }

        const attemptsRemain = attempt < maxAttempts
        if (attemptsRemain && retryIsSafe) {
          const delayMs = Math.min(30_000, retryBackoffMs * (2 ** (attempt - 1)))
          options.onEvent?.({
            kind: 'retry',
            worker: workerId,
            taskId: task.id,
            attempt: attempt + 1,
            delayMs,
            reason: failureReason ?? 'Worker failed.',
          })
          if (!(await retryDelay(delayMs, options.signal))) {
            completeTask(cwd, name, task.id, {
              status: 'failed',
              output: 'Cancelled while waiting to retry an isolated worker attempt.',
              verdict: 'FAIL',
              worktree: workerCwd === cwd ? undefined : workerCwd,
              error: 'Crew run cancelled.',
            })
            handled.push({ worker: workerId, taskId: task.id, status: 'failed', attempts: attempt })
            options.onEvent?.({ kind: 'cancelled', worker: workerId, taskId: task.id })
            cancellationEmitted = true
            count += 1
            break
          }
          const next = beginRetry(cwd, name, task.id, workerId)
          if (!next) {
            completeTask(cwd, name, task.id, {
              status: 'failed',
              output,
              verdict,
              worktree: workerCwd === cwd ? undefined : workerCwd,
              error: 'Task state changed before its retry could start.',
            })
            handled.push({ worker: workerId, taskId: task.id, status: 'failed', attempts: attempt })
            count += 1
            break
          }
          task = next
          continue
        }

        if (attemptsRemain && !retryIsSafe) {
          options.onEvent?.({
            kind: 'retry-skipped',
            worker: workerId,
            taskId: task.id,
            reason: 'Shared-workspace mutations may be ambiguous; use fresh worktrees to enable safe retries.',
          })
        }
        completeTask(cwd, name, task.id, {
          status: 'failed',
          output,
          verdict,
          worktree: workerCwd === cwd ? undefined : workerCwd,
          error: failureReason,
        })
        handled.push({ worker: workerId, taskId: task.id, status: 'failed', attempts: attempt })
        options.onEvent?.({
          kind: 'done',
          worker: workerId,
          taskId: task.id,
          status: 'failed',
          verdict,
          attempts: attempt,
        })
        count += 1
        break
      }
    }
    if (options.signal?.aborted && !cancellationEmitted) {
      options.onEvent?.({ kind: 'cancelled', worker: workerId })
    }
    options.onEvent?.({ kind: 'worker-exit', worker: workerId, handled: count })
    return count
  }

  // A worker can throw — a corrupt crew file, a failed worktree setup, a
  // throwing onEvent callback. Racing or Promise.all-ing raw worker promises
  // meant the first throw propagated immediately and left every sibling
  // running with nobody awaiting it: their worktrees and child processes
  // outlived the run, and a second worker failing afterwards surfaced as an
  // unhandled rejection. Failures are collected instead, and rethrown once
  // every worker has actually finished.
  const workerFailures: unknown[] = []
  const track = (promise: Promise<number>): Promise<number> =>
    promise.catch(error => {
      workerFailures.push(error)
      return 0
    })

  let spawned = 0
  if (options.dynamic) {
    // Dynamic fan-out (Claude Code "Dynamic Workflows" pattern): scale the
    // worker pool to the board instead of a fixed count. New tasks appended
    // mid-run (ur crew add) get picked up as long as any worker is alive;
    // when all workers drain and todos remain (appended after drain), a new
    // wave spawns. The governor caps concurrency so a runaway decomposition
    // cannot fork-bomb the machine.
    const governor = boundedInteger(options.maxWorkers, 8, 1, 32)
    const active = new Set<Promise<number>>()
    const runnableCount = (): number => {
      const spec = loadCrew(cwd, name)
      if (!spec) return 0
      const byId = new Map(spec.tasks.map(task => [task.id, task]))
      return spec.tasks.filter(
        task =>
          task.status === 'todo' &&
          (task.attempts ?? 0) < maxAttempts &&
          (task.dependsOn ?? []).every(dep => byId.get(dep)?.status === 'done'),
      ).length
    }
    const todoCount = (): number =>
      loadCrew(cwd, name)?.tasks.filter(task => task.status === 'todo').length ?? 0
    while (!options.signal?.aborted) {
      while (active.size < governor && runnableCount() > 0) {
        spawned += 1
        const id = `w${spawned}`
        const p: Promise<number> = track(worker(id)).finally(() =>
          active.delete(p),
        )
        active.add(p)
      }
      if (active.size === 0) {
        // Give claimNextTask one chance to turn invalid/missing/cyclic
        // dependencies into terminal blocked tasks.
        if (todoCount() > 0) {
          spawned += 1
          await track(worker(`w${spawned}`))
          continue
        }
        break
      }
      await Promise.race(active)
      if (active.size === 0 && runnableCount() === 0) break
    }
    await Promise.all(active)
  } else {
    spawned = workerCount
    const workerIds = Array.from({ length: workerCount }, (_, i) => `w${i + 1}`)
    await Promise.all(workerIds.map(id => track(worker(id))))
  }

  // Surfaced only now, so the caller still sees the failure but no worker was
  // abandoned mid-task to produce it.
  if (workerFailures.length > 0) {
    throw workerFailures[0]
  }

  const finalSpec = loadCrew(cwd, name) ?? baseSpec
  if (!options.dryRun) {
    recordOutcomes(
      cwd,
      finalSpec.tasks
        .filter(task => task.status === 'done' || task.status === 'failed')
        .map(task => ({
          id: `crew:${baseSpec.createdAt}:${task.id}:attempt-${task.attempts ?? 1}`,
          task: task.title,
          model: null,
          pass: task.status === 'done' && task.verdict !== 'FAIL',
          detail: `crew ${name} ${task.status}: ${task.title}`,
        })),
    )
  }
  return { name, workers: spawned, progress: crewProgress(finalSpec), handled }
}

export function formatCrewList(crews: CrewSpec[], json: boolean): string {
  if (json) return JSON.stringify({ crews: crews.map(c => ({ name: c.name, goal: c.goal, ...crewProgress(c) })) }, null, 2)
  if (crews.length === 0) {
    return 'No crews yet. Create one with `ur crew create <name> --goal "..."`.'
  }
  const lines = ['Crews', '']
  for (const crew of crews) {
    const p = crewProgress(crew)
    lines.push(`${crew.name}  (${p.done}/${p.total} done${p.failed ? `, ${p.failed} failed` : ''})`)
    lines.push(`  ${crew.goal}`)
    lines.push('')
  }
  return lines.join('\n')
}

export function formatCrew(spec: CrewSpec, json: boolean): string {
  if (json) return JSON.stringify({ ...spec, progress: crewProgress(spec) }, null, 2)
  const p = crewProgress(spec)
  const mark: Record<CrewTaskStatus, string> = {
    todo: '○',
    claimed: '◐',
    done: '✓',
    failed: '✗',
    blocked: '⊘',
  }
  const lines = [
    `Crew: ${spec.name}`,
    `Goal: ${spec.goal}`,
    `Lead: ${spec.lead}`,
    `Progress: ${p.done}/${p.total} done, ${p.todo} todo, ${p.claimed} in-progress, ${p.failed} failed, ${p.blocked} blocked`,
    '',
    'Tasks:',
  ]
  for (const task of spec.tasks) {
    lines.push(`  ${mark[task.status]} ${task.id} ${task.title}${task.assignee ? `  [${task.assignee}]` : ''}${task.verdict ? `  (${task.verdict})` : ''}`)
  }
  return lines.join('\n')
}

export function formatRunCrewResult(result: RunCrewResult, json: boolean): string {
  if (json) return JSON.stringify(result, null, 2)
  const p = result.progress
  const lines = [
    `Crew ${result.name} ran with ${result.workers} worker(s).`,
    `Handled ${result.handled.length} task(s); ${p.done}/${p.total} done${p.failed ? `, ${p.failed} failed` : ''}${p.blocked ? `, ${p.blocked} blocked` : ''}.`,
  ]
  for (const item of result.handled) {
    lines.push(`  ${item.worker} → ${item.taskId}: ${item.status} (${item.attempts} attempt${item.attempts === 1 ? '' : 's'})`)
  }
  return lines.join('\n')
}
