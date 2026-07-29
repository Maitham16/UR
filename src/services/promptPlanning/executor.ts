import { resolvePromptPlanningConfig } from './config.js'
import { realpathSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import {
  captureWorkspaceFileState,
  diffWorkspaceFileState,
} from './evidence.js'
import { renderTaskBoard } from './taskBoard.js'
import type {
  NexusTask,
  NexusTaskStatus,
  PromptPlan,
  PromptPlanningConfig,
  RunPromptPlanOptions,
  RunPromptPlanResult,
  TaskApprovalDecision,
  TaskExecutionResult,
  TaskRunRecord,
  VerificationIssue,
} from './types.js'
import {
  validateAfterExecution,
  validateBeforeExecution,
} from './validation.js'

function cloneTasks(tasks: NexusTask[]): NexusTask[] {
  return tasks.map(task => ({
    ...task,
    dependencies: [...task.dependencies],
    input: {
      ...task.input,
      assumptions: [...task.input.assumptions],
      requiredFiles: [...task.input.requiredFiles],
      targetFiles: [...task.input.targetFiles],
      resources: [...task.input.resources],
    },
    verificationCriteria: [...task.verificationCriteria],
    fileTargets: [...task.fileTargets],
    approvalPaths: [...task.approvalPaths],
    outsideWorkspacePaths: [...task.outsideWorkspacePaths],
  }))
}

type BoardEmissionState = {
  lastBoard?: string
}

type TaskRecords = Map<NexusTask, TaskRunRecord>

const READ_ONLY_TASK_PATTERN =
  /^\s*(?:analy[sz]e|audit|compare|explain|inspect|list|plan|read|review)\b/i
const MUTATING_TASK_PATTERN =
  /\b(?:add|address|apply|build|bump|changes?|correct|create|delete|deploy|edit|enhance|execute|export|fix|format|generate|harden|implement|improve|install|modify|move|optimi[sz]e|patch|publish|refactor|remove|rename|repair|resolve|run|save|scaffold|update|write)\b/i

export function isClearlyReadOnlyTask(task: NexusTask): boolean {
  const description = `${task.title}\n${task.description}\n${task.input.prompt}`
  return (
    READ_ONLY_TASK_PATTERN.test(description) &&
    !MUTATING_TASK_PATTERN.test(description)
  )
}

function canonicalLockKey(cwd: string, value: string): string {
  const absolute = resolve(cwd, value)
  try {
    return realpathSync.native(absolute)
  } catch {
    // The target may not exist yet. Canonicalize its deepest existing parent
    // so aliases such as `file`, `./file`, and `linked-dir/file` share a lock.
    const suffix: string[] = []
    let current = absolute
    for (;;) {
      const parent = dirname(current)
      if (parent === current) return absolute
      suffix.unshift(basename(current))
      current = parent
      try {
        return resolve(realpathSync.native(current), ...suffix)
      } catch {
        // Keep walking toward an existing ancestor.
      }
    }
  }
}

function lockKeys(task: NexusTask, cwd: string): string[] {
  if (isClearlyReadOnlyTask(task)) return []

  // Workspace snapshots cannot reliably attribute overlapping writes to an
  // individual task. A shared mutation lock preserves honest evidence. The
  // separate crew/worktree path provides isolated parallel mutation.
  return [canonicalLockKey(cwd, '.')]
}

function canStartTask(
  task: NexusTask,
  activeTasks: Set<NexusTask>,
  activeLocks: Set<string>,
  cwd: string,
): boolean {
  if (isLocked(task, activeLocks, cwd)) return false
  if (isClearlyReadOnlyTask(task)) {
    return [...activeTasks].every(isClearlyReadOnlyTask)
  }
  return activeTasks.size === 0
}

function dependenciesFinished(task: NexusTask, tasksById: Map<string, NexusTask>): boolean {
  return task.dependencies.every(id => tasksById.get(id)?.status === 'finished')
}

function blockingDependencies(
  task: NexusTask,
  tasksById: Map<string, NexusTask>,
): NexusTask[] {
  return task.dependencies.flatMap(id => {
    const dependency = tasksById.get(id)
    if (!dependency) return []
    const status = tasksById.get(id)?.status
    return [
      'failed',
      'blocked',
      'waiting-approval',
      'needs-scope',
      'needs-context',
      'paused-review',
      'skipped',
    ].includes(status ?? '')
      ? [dependency]
      : []
  })
}

function isLocked(
  task: NexusTask,
  activeLocks: Set<string>,
  cwd: string,
): boolean {
  return lockKeys(task, cwd).some(key => activeLocks.has(key))
}

function acquireLocks(
  task: NexusTask,
  activeLocks: Set<string>,
  cwd: string,
): void {
  for (const key of lockKeys(task, cwd)) activeLocks.add(key)
}

function releaseLocks(
  task: NexusTask,
  activeLocks: Set<string>,
  cwd: string,
): void {
  for (const key of lockKeys(task, cwd)) activeLocks.delete(key)
}

function validateTaskGraph(
  tasks: NexusTask[],
): Map<NexusTask, VerificationIssue[]> {
  const issues = new Map<NexusTask, VerificationIssue[]>()
  const tasksById = new Map<string, NexusTask[]>()
  const addIssue = (task: NexusTask, issue: VerificationIssue): void => {
    const current = issues.get(task) ?? []
    if (!current.some(entry => entry.code === issue.code && entry.message === issue.message)) {
      current.push(issue)
      issues.set(task, current)
    }
  }

  for (const task of tasks) {
    if (!Number.isSafeInteger(task.order) || task.order < 1) {
      addIssue(task, {
        code: 'invalid_task_order',
        message: `${task.id || 'Unnamed task'} has invalid order ${String(task.order)}; order must be a positive safe integer.`,
        severity: 'error',
      })
    }
    if (!task.id.trim()) {
      addIssue(task, {
        code: 'missing_task_id',
        message: 'A planned task has an empty id and cannot be scheduled safely.',
        severity: 'error',
      })
      continue
    }
    const matching = tasksById.get(task.id) ?? []
    matching.push(task)
    tasksById.set(task.id, matching)
  }

  for (const [id, matching] of tasksById) {
    if (matching.length < 2) continue
    for (const task of matching) {
      addIssue(task, {
        code: 'duplicate_task_id',
        message: `Task id ${id} appears ${matching.length} times; task identities must be unique.`,
        severity: 'error',
      })
    }
  }

  for (const task of tasks) {
    for (const dependencyId of task.dependencies) {
      if (dependencyId === task.id) {
        addIssue(task, {
          code: 'self_dependency',
          message: `${task.id} cannot depend on itself.`,
          severity: 'error',
        })
        continue
      }
      const matching = tasksById.get(dependencyId) ?? []
      if (matching.length === 0) {
        addIssue(task, {
          code: 'missing_dependency',
          message: `${task.id} depends on missing task ${dependencyId}.`,
          severity: 'error',
        })
      } else if (matching.length > 1) {
        addIssue(task, {
          code: 'ambiguous_dependency',
          message: `${task.id} depends on duplicate task id ${dependencyId}.`,
          severity: 'error',
        })
      }
    }
  }

  const state = new Map<NexusTask, 'visiting' | 'visited'>()
  const stack: NexusTask[] = []
  const visit = (task: NexusTask): void => {
    const currentState = state.get(task)
    if (currentState === 'visited') return
    if (currentState === 'visiting') {
      const cycleStart = stack.indexOf(task)
      const cycle = cycleStart >= 0 ? stack.slice(cycleStart) : [task]
      const cyclePath = [...cycle.map(entry => entry.id), task.id].join(' -> ')
      for (const member of cycle) {
        addIssue(member, {
          code: 'cyclic_dependency',
          message: `Task dependency cycle detected: ${cyclePath}.`,
          severity: 'error',
        })
      }
      return
    }

    state.set(task, 'visiting')
    stack.push(task)
    for (const dependencyId of task.dependencies) {
      const matching = tasksById.get(dependencyId)
      if (matching?.length === 1 && matching[0] !== task) {
        visit(matching[0]!)
      }
    }
    stack.pop()
    state.set(task, 'visited')
  }

  for (const task of tasks) {
    if ((tasksById.get(task.id)?.length ?? 0) === 1) visit(task)
  }
  return issues
}

function summary(
  tasks: NexusTask[],
  records: TaskRecords,
  maxAgentsAllowed: number,
  maxAgentsUsed: number,
): RunPromptPlanResult {
  const taskResults = tasks.map(task => {
    const record = records.get(task)
    if (record) return record
    return unexecutedRecord(task)
  })
  return {
    tasks,
    finished: tasks.filter(task => task.status === 'finished').length,
    failed: tasks.filter(task => task.status === 'failed').length,
    blocked: tasks.filter(task => task.status === 'blocked').length,
    waitingApproval: tasks.filter(task =>
      [
        'waiting-approval',
        'needs-scope',
        'needs-context',
        'paused-review',
      ].includes(task.status),
    ).length,
    skipped: tasks.filter(task => task.status === 'skipped').length,
    maxAgentsAllowed,
    maxAgentsUsed,
    approvalDecisions: uniqueApprovalDecisions(
      taskResults.flatMap(record => record.approvalDecisions),
    ),
    outsideWorkspaceReads: unique(
      taskResults.flatMap(record => record.outsideWorkspaceReads),
    ),
    outsideWorkspaceWrites: unique(
      taskResults.flatMap(record => record.outsideWorkspaceWrites),
    ),
    taskResults,
  }
}

function unique(values: Iterable<string>): string[] {
  return [...new Set([...values].map(value => value.trim()).filter(Boolean))]
}

const EXECUTION_STRING_ARRAY_FIELDS = [
  'changedFiles',
  'reportedChangedFiles',
  'observedChangedFiles',
  'commandsRun',
  'reportedCommands',
  'observedCommands',
  'outsideWorkspaceReads',
  'outsideWorkspaceWrites',
] as const

function normalizeExecutionResult(value: unknown): TaskExecutionResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      ok: false,
      error: 'Task executor returned no structured execution result.',
    }
  }
  const record = value as Record<string, unknown>
  if (typeof record.ok !== 'boolean') {
    return {
      ok: false,
      error: 'Task executor result is missing the required boolean `ok` field.',
    }
  }
  if (
    (record.output !== undefined && typeof record.output !== 'string') ||
    (record.error !== undefined && typeof record.error !== 'string')
  ) {
    return {
      ok: false,
      error: 'Task executor returned a non-string output or error field.',
    }
  }

  for (const field of EXECUTION_STRING_ARRAY_FIELDS) {
    const fieldValue = record[field]
    if (
      fieldValue !== undefined &&
      (!Array.isArray(fieldValue) ||
        fieldValue.some(item => typeof item !== 'string'))
    ) {
      return {
        ok: false,
        error: `Task executor returned an invalid ${field} evidence list.`,
      }
    }
  }

  const claims = record.claims
  if (
    claims !== undefined &&
    (!Array.isArray(claims) ||
      claims.some(
        claim =>
          !claim ||
          typeof claim !== 'object' ||
          !['fileChanged', 'commandRun', 'output'].includes(
            String((claim as Record<string, unknown>).type),
          ) ||
          typeof (claim as Record<string, unknown>).value !== 'string',
      ))
  ) {
    return {
      ok: false,
      error: 'Task executor returned an invalid claims list.',
    }
  }

  const approvalDecisions = record.approvalDecisions
  if (
    approvalDecisions !== undefined &&
    (!Array.isArray(approvalDecisions) ||
      approvalDecisions.some(decision => {
        if (!decision || typeof decision !== 'object') return true
        const item = decision as Record<string, unknown>
        return (
          typeof item.taskId !== 'string' ||
          typeof item.taskTitle !== 'string' ||
          ![
            'not-required',
            'waiting-approval',
            'approved',
            'skipped-by-policy',
          ].includes(String(item.status)) ||
          typeof item.reason !== 'string' ||
          typeof item.action !== 'string' ||
          (item.command !== undefined && typeof item.command !== 'string') ||
          !Array.isArray(item.paths) ||
          item.paths.some(path => typeof path !== 'string')
        )
      }))
  ) {
    return {
      ok: false,
      error: 'Task executor returned an invalid approval decision list.',
    }
  }

  return value as TaskExecutionResult
}

function uniqueApprovalDecisions(
  values: Iterable<TaskApprovalDecision>,
): TaskApprovalDecision[] {
  const seen = new Set<string>()
  const decisions: TaskApprovalDecision[] = []
  for (const value of values) {
    const key = `${value.taskId}:${value.status}:${value.action}`
    if (seen.has(key)) continue
    seen.add(key)
    decisions.push(value)
  }
  return decisions
}

function approvalDecisionFor(task: NexusTask): TaskApprovalDecision | null {
  if (!task.approvalRequired) return null
  return {
    taskId: task.id,
    taskTitle: task.title,
    status: task.status === 'skipped' ? 'skipped-by-policy' : 'waiting-approval',
    reason:
      task.approvalReason ??
      'Explicit approval is required before this action can run.',
    action: task.approvalAction ?? task.description,
    command: task.approvalCommand,
    paths: task.approvalPaths,
  }
}

function issueForUnexecutedTask(task: NexusTask): VerificationIssue {
  switch (task.status) {
    case 'waiting-approval':
      return {
        code: 'approval_required',
        message: `${task.id} was not executed because explicit approval is required.`,
        severity: 'error',
      }
    case 'needs-scope':
      return {
        code: 'needs_scope',
        message: `${task.id} was not executed because target scope or authorization is missing.`,
        severity: 'error',
      }
    case 'needs-context':
      return {
        code: 'needs_context',
        message: `${task.id} was not executed because required context is missing.`,
        severity: 'error',
      }
    case 'paused-review':
      return {
        code: 'paused_for_review',
        message: `${task.id} was not executed because it is paused for review.`,
        severity: 'error',
      }
    case 'blocked':
      return {
        code: 'blocked',
        message: `${task.id} was not executed because a prerequisite did not complete.`,
        severity: 'error',
      }
    case 'failed':
      return {
        code: 'preexisting_failure',
        message: `${task.id} entered this run in a failed state and was not retried.`,
        severity: 'error',
      }
    case 'skipped':
      return {
        code: 'skipped_by_policy',
        message: `${task.id} was skipped and was not executed.`,
        severity: 'warning',
      }
    case 'finished':
      return {
        code: 'preexisting_completion_not_reverified',
        message: `${task.id} entered this run as finished; this run did not re-execute or re-verify it.`,
        severity: 'warning',
      }
    default:
      return {
        code: 'not_executed',
        message: `${task.id} did not execute during this run.`,
        severity: 'error',
      }
  }
}

function unexecutedRecord(
  task: NexusTask,
  issues: VerificationIssue[] = [issueForUnexecutedTask(task)],
): TaskRunRecord {
  const approval = approvalDecisionFor(task)
  return {
    taskId: task.id,
    task,
    finishedAt: new Date().toISOString(),
    actualChangedFiles: [],
    reportedChangedFiles: [],
    unreportedChangedFiles: [],
    observedCommands: [],
    reportedCommands: [],
    unverifiedCommandClaims: [],
    outsideWorkspaceReads: [],
    outsideWorkspaceWrites: [],
    approvalDecisions: approval ? [approval] : [],
    preVerification: {
      ok: issues.every(issue => issue.severity !== 'error'),
      blocked: issues.some(issue => issue.severity === 'error'),
      issues,
    },
  }
}

function reportedChangedFiles(result?: TaskExecutionResult): string[] {
  return unique([
    ...(result?.reportedChangedFiles ?? []),
    ...(result?.changedFiles ?? []),
  ])
}

function observedCommands(result?: TaskExecutionResult): string[] {
  return unique([
    ...(result?.commandsRun ?? []),
    ...(result?.observedCommands ?? []),
  ])
}

function reportedCommands(result?: TaskExecutionResult): string[] {
  return unique(result?.reportedCommands ?? [])
}

function issueValues(
  issues: { code: string; value?: string }[],
  code: string,
): string[] {
  return unique(
    issues
      .filter(issue => issue.code === code && issue.value)
      .map(issue => issue.value!),
  )
}

function emitBoard(
  options: RunPromptPlanOptions,
  tasks: NexusTask[],
  maxAgents: number,
  config: PromptPlanningConfig,
  boardState: BoardEmissionState,
): void {
  if (!config.showTaskBoard) return

  const board = renderTaskBoard(tasks, { maxAgents })
  if (boardState.lastBoard === board) return
  boardState.lastBoard = board

  options.onEvent?.({
    type: 'board',
    board,
    tasks,
  })
}

function emitStatus(
  options: RunPromptPlanOptions,
  task: NexusTask,
  tasks: NexusTask[],
  lastStatuses: Map<NexusTask, NexusTaskStatus>,
  maxAgents: number,
  config: PromptPlanningConfig,
  boardState: BoardEmissionState,
): void {
  if (lastStatuses.get(task) === task.status) return
  lastStatuses.set(task, task.status)
  options.onEvent?.({ type: 'status', task, tasks })
  emitBoard(options, tasks, maxAgents, config, boardState)
}

function waitingStatusFor(task: NexusTask): NexusTaskStatus {
  if (task.status === 'needs-scope') return 'needs-scope'
  if (task.status === 'needs-context') return 'needs-context'
  if (task.status === 'paused-review') return 'paused-review'
  if (task.status === 'skipped') return 'skipped'
  if (task.approvalRequired) return 'waiting-approval'
  return 'needs-context'
}

function runnablePlanningTasks(tasks: NexusTask[]): NexusTask[] {
  return tasks.filter(task =>
    ['pending', 'ready'].includes(task.status),
  )
}

function independentWidth(tasks: NexusTask[], cwd: string): number {
  const selectedLocks = new Set<string>()
  let width = 0
  for (const task of runnablePlanningTasks(tasks)) {
    const keys = lockKeys(task, cwd)
    if (keys.length > 0 && keys.some(key => selectedLocks.has(key))) continue
    for (const key of keys) selectedLocks.add(key)
    width += 1
  }
  return width
}

function usefulAgentCount(
  tasks: NexusTask[],
  config: { parallelAgents: boolean; maxAgents: number },
  cwd: string,
): number {
  if (!config.parallelAgents) return 1
  const runnable = runnablePlanningTasks(tasks)
  if (runnable.length <= 1) return 1

  const width = Math.max(1, independentWidth(tasks, cwd))
  if (runnable.length <= 4) {
    return Math.max(1, Math.min(config.maxAgents, 3, width))
  }
  return Math.max(1, Math.min(config.maxAgents, width))
}

async function runOneTask(
  task: NexusTask,
  tasks: NexusTask[],
  options: RunPromptPlanOptions,
  records: TaskRecords,
  lastStatuses: Map<NexusTask, NexusTaskStatus>,
  maxAgents: number,
  config: PromptPlanningConfig,
  boardState: BoardEmissionState,
): Promise<void> {
  const before = validateBeforeExecution(task, {
    cwd: options.cwd,
    strict: config.strictVerification,
  })
  const approval = approvalDecisionFor(task)
  const record: TaskRunRecord = {
    taskId: task.id,
    task,
    startedAt: new Date().toISOString(),
    actualChangedFiles: [],
    reportedChangedFiles: [],
    unreportedChangedFiles: [],
    observedCommands: [],
    reportedCommands: [],
    unverifiedCommandClaims: [],
    outsideWorkspaceReads: [],
    outsideWorkspaceWrites: [],
    approvalDecisions: approval ? [approval] : [],
    preVerification: before,
  }
  records.set(task, record)
  if (!before.ok) {
    task.status = waitingStatusFor(task)
    record.task = task
    record.finishedAt = new Date().toISOString()
    emitStatus(
      options,
      task,
      tasks,
      lastStatuses,
      maxAgents,
      config,
      boardState,
    )
    return
  }

  task.status = 'running'
  emitStatus(
    options,
    task,
    tasks,
    lastStatuses,
    maxAgents,
    config,
    boardState,
  )
  const workspaceBefore = captureWorkspaceFileState(options.cwd)

  let result: TaskExecutionResult
  try {
    result = normalizeExecutionResult(await options.executeTask(task))
  } catch (error) {
    result = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
  const workspaceAfter = captureWorkspaceFileState(options.cwd)
  const actualChangedFiles = unique([
    ...diffWorkspaceFileState(workspaceBefore, workspaceAfter),
    ...(result.observedChangedFiles ?? []),
  ])
  const observed = observedCommands(result)
  const reportedFiles = reportedChangedFiles(result)
  const reportedCommandClaims = reportedCommands(result)
  const outsideWorkspaceReads = unique(result.outsideWorkspaceReads ?? [])
  const outsideWorkspaceWrites = unique(result.outsideWorkspaceWrites ?? [])

  const after = validateAfterExecution(task, result, {
    cwd: options.cwd,
    strict: config.strictVerification,
    actualChangedFiles,
    commandsRun: observed,
    output: result.output,
  })
  if (isClearlyReadOnlyTask(task) && actualChangedFiles.length > 0) {
    after.ok = false
    after.issues.push({
      code: 'read_only_task_modified_workspace',
      message: `${task.id} was classified as read-only but changed workspace files: ${actualChangedFiles.join(', ')}.`,
      severity: 'error',
    })
  }
  record.execution = result
  record.actualChangedFiles = actualChangedFiles
  record.reportedChangedFiles = reportedFiles
  record.unreportedChangedFiles = issueValues(
    after.issues,
    'unreported_file_change',
  )
  record.observedCommands = observed
  record.reportedCommands = reportedCommandClaims
  record.unverifiedCommandClaims = issueValues(
    after.issues,
    'unsupported_command_claim',
  )
  record.outsideWorkspaceReads = outsideWorkspaceReads
  record.outsideWorkspaceWrites = outsideWorkspaceWrites
  record.approvalDecisions = uniqueApprovalDecisions([
    ...record.approvalDecisions,
    ...(result.approvalDecisions ?? []),
  ])
  record.postVerification = after
  record.finishedAt = new Date().toISOString()
  task.status = result.ok && after.ok ? 'finished' : 'failed'
  emitStatus(
    options,
    task,
    tasks,
    lastStatuses,
    maxAgents,
    config,
    boardState,
  )
}

export async function runPromptPlan(
  plan: PromptPlan,
  options: RunPromptPlanOptions,
): Promise<RunPromptPlanResult> {
  const planConfig = resolvePromptPlanningConfig(plan.config)
  const config = resolvePromptPlanningConfig(options.config, planConfig)
  const tasks = cloneTasks(plan.tasks).sort((left, right) => {
    const leftOrder = Number.isFinite(left.order)
      ? left.order
      : Number.MAX_SAFE_INTEGER
    const rightOrder = Number.isFinite(right.order)
      ? right.order
      : Number.MAX_SAFE_INTEGER
    return leftOrder - rightOrder || left.id.localeCompare(right.id)
  })
  for (const task of tasks) {
    if (['pending', 'ready', 'running'].includes(task.status)) {
      task.status = task.dependencies.length > 0 ? 'pending' : 'ready'
    }
  }

  const idCounts = new Map<string, number>()
  for (const task of tasks) {
    idCounts.set(task.id, (idCounts.get(task.id) ?? 0) + 1)
  }
  const tasksById = new Map(
    tasks
      .filter(task => idCounts.get(task.id) === 1)
      .map(task => [task.id, task]),
  )
  const records: TaskRecords = new Map()
  const activeLocks = new Set<string>()
  const activeTasks = new Set<NexusTask>()
  const running = new Set<Promise<void>>()
  const lastStatuses = new Map<NexusTask, NexusTaskStatus>()
  const boardState: BoardEmissionState = {}
  const graphIssues = validateTaskGraph(tasks)
  for (const [task, issues] of graphIssues) {
    task.status = 'needs-context'
    records.set(task, unexecutedRecord(task, issues))
  }
  const maxAgentsAllowed = config.parallelAgents ? config.maxAgents : 1
  const maxAgents = usefulAgentCount(
    tasks,
    {
      parallelAgents: config.parallelAgents,
      maxAgents: maxAgentsAllowed,
    },
    options.cwd,
  )
  let maxAgentsUsed = 0

  emitBoard(options, tasks, maxAgentsAllowed, config, boardState)
  for (const task of graphIssues.keys()) {
    emitStatus(
      options,
      task,
      tasks,
      lastStatuses,
      maxAgentsAllowed,
      config,
      boardState,
    )
  }

  while (true) {
    for (const task of tasks) {
      const blockers = blockingDependencies(task, tasksById)
      if (task.status === 'pending' && blockers.length > 0) {
        task.status = 'blocked'
        const details = blockers
          .map(dependency => `${dependency.id} (${dependency.status})`)
          .join(', ')
        records.set(
          task,
          unexecutedRecord(task, [
            {
              code: 'dependency_not_completed',
              message: `${task.id} was not executed because prerequisite tasks did not finish: ${details}.`,
              severity: 'error',
            },
          ]),
        )
        emitStatus(
          options,
          task,
          tasks,
          lastStatuses,
          maxAgentsAllowed,
          config,
          boardState,
        )
      }
      if (task.status === 'pending' && dependenciesFinished(task, tasksById)) {
        task.status = 'ready'
        emitStatus(
          options,
          task,
          tasks,
          lastStatuses,
          maxAgentsAllowed,
          config,
          boardState,
        )
      }
    }

    const ready = tasks.filter(
      task =>
        task.status === 'ready' &&
        running.size < maxAgents &&
        canStartTask(task, activeTasks, activeLocks, options.cwd),
    )

    for (const task of ready) {
      if (running.size >= maxAgents) break
      if (!canStartTask(task, activeTasks, activeLocks, options.cwd)) continue
      acquireLocks(task, activeLocks, options.cwd)
      activeTasks.add(task)
      const promise = runOneTask(
        task,
        tasks,
        options,
        records,
        lastStatuses,
        maxAgentsAllowed,
        config,
        boardState,
      ).finally(() => {
        releaseLocks(task, activeLocks, options.cwd)
        activeTasks.delete(task)
        running.delete(promise)
      })
      running.add(promise)
      maxAgentsUsed = Math.max(maxAgentsUsed, running.size)
    }

    if (running.size === 0) {
      const open = tasks.some(task =>
        ['pending', 'ready', 'running'].includes(task.status),
      )
      if (!open) {
        return summary(tasks, records, maxAgentsAllowed, maxAgentsUsed)
      }

      for (const task of tasks) {
        if (task.status === 'pending' || task.status === 'ready') {
          task.status = 'blocked'
          records.set(
            task,
            unexecutedRecord(task, [
              {
                code: 'unsatisfied_dependencies',
                message: `${task.id} cannot continue because dependencies did not finish.`,
                severity: 'error',
              },
            ]),
          )
          emitStatus(
            options,
            task,
            tasks,
            lastStatuses,
            maxAgentsAllowed,
            config,
            boardState,
          )
        }
      }
      return summary(tasks, records, maxAgentsAllowed, maxAgentsUsed)
    }

    await Promise.race(running)
  }
}
