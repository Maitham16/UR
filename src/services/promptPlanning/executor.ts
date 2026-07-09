import {
  DEFAULT_PROMPT_PLANNING_CONFIG,
  resolvePromptPlanningConfig,
} from './config.js'
import {
  captureWorkspaceFileState,
  diffWorkspaceFileState,
} from './evidence.js'
import { renderTaskBoard } from './taskBoard.js'
import type {
  NexusTask,
  NexusTaskStatus,
  PromptPlan,
  RunPromptPlanOptions,
  RunPromptPlanResult,
  TaskApprovalDecision,
  TaskExecutionResult,
  TaskRunRecord,
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

function lockKeys(task: NexusTask): string[] {
  return [...new Set([...task.input.requiredFiles, ...task.input.targetFiles])]
}

function dependenciesFinished(task: NexusTask, tasksById: Map<string, NexusTask>): boolean {
  return task.dependencies.every(id => tasksById.get(id)?.status === 'finished')
}

function dependenciesFailed(task: NexusTask, tasksById: Map<string, NexusTask>): boolean {
  return task.dependencies.some(id => {
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
  })
}

function isLocked(task: NexusTask, activeLocks: Set<string>): boolean {
  return lockKeys(task).some(key => activeLocks.has(key))
}

function acquireLocks(task: NexusTask, activeLocks: Set<string>): void {
  for (const key of lockKeys(task)) activeLocks.add(key)
}

function releaseLocks(task: NexusTask, activeLocks: Set<string>): void {
  for (const key of lockKeys(task)) activeLocks.delete(key)
}

function summary(
  tasks: NexusTask[],
  records: Map<string, TaskRunRecord>,
  maxAgentsAllowed: number,
  maxAgentsUsed: number,
): RunPromptPlanResult {
  const taskResults = tasks.map(task => {
    const record = records.get(task.id)
    if (record) return record
    return {
      taskId: task.id,
      task,
      actualChangedFiles: [],
      reportedChangedFiles: [],
      unreportedChangedFiles: [],
      observedCommands: [],
      reportedCommands: [],
      unverifiedCommandClaims: [],
      outsideWorkspaceReads: [],
      outsideWorkspaceWrites: [],
      approvalDecisions: approvalDecisionFor(task)
        ? [approvalDecisionFor(task)!]
        : [],
      preVerification: { ok: true, blocked: false, issues: [] },
    }
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

// Track the last board emitted for this run to avoid printing duplicate boards.
const lastBoardByRun = new WeakMap<RunPromptPlanOptions, string>()

function emitBoard(
  options: RunPromptPlanOptions,
  tasks: NexusTask[],
  maxAgents: number,
): void {
  const config = {
    ...DEFAULT_PROMPT_PLANNING_CONFIG,
    ...resolvePromptPlanningConfig(options.config),
  }
  if (!config.showTaskBoard) return

  const board = renderTaskBoard(tasks, { maxAgents })
  const lastBoard = lastBoardByRun.get(options)
  if (lastBoard === board) return
  lastBoardByRun.set(options, board)

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
  lastStatuses: Map<string, NexusTaskStatus>,
  maxAgents: number,
): void {
  if (lastStatuses.get(task.id) === task.status) return
  lastStatuses.set(task.id, task.status)
  options.onEvent?.({ type: 'status', task, tasks })
  emitBoard(options, tasks, maxAgents)
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

function independentWidth(tasks: NexusTask[]): number {
  const selectedLocks = new Set<string>()
  let width = 0
  for (const task of runnablePlanningTasks(tasks)) {
    if (task.dependencies.length > 0) continue
    const keys = lockKeys(task)
    if (keys.length > 0 && keys.some(key => selectedLocks.has(key))) continue
    for (const key of keys) selectedLocks.add(key)
    width += 1
  }
  return width
}

function usefulAgentCount(
  tasks: NexusTask[],
  config: { parallelAgents: boolean; maxAgents: number },
): number {
  if (!config.parallelAgents) return 1
  const runnable = runnablePlanningTasks(tasks)
  if (runnable.length <= 1) return 1

  const width = Math.max(1, independentWidth(tasks))
  if (runnable.length <= 4) {
    return Math.max(1, Math.min(config.maxAgents, 3, width))
  }
  return Math.max(1, Math.min(config.maxAgents, width))
}

async function runOneTask(
  task: NexusTask,
  tasks: NexusTask[],
  options: RunPromptPlanOptions,
  records: Map<string, TaskRunRecord>,
  lastStatuses: Map<string, NexusTaskStatus>,
  maxAgents: number,
): Promise<void> {
  const config = {
    ...DEFAULT_PROMPT_PLANNING_CONFIG,
    ...resolvePromptPlanningConfig(options.config),
  }
  const before = validateBeforeExecution(task, {
    cwd: options.cwd,
    strict: config.strictVerification,
  })
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
    approvalDecisions: approvalDecisionFor(task)
      ? [approvalDecisionFor(task)!]
      : [],
    preVerification: before,
  }
  records.set(task.id, record)
  if (!before.ok) {
    task.status = waitingStatusFor(task)
    record.task = task
    record.finishedAt = new Date().toISOString()
    emitStatus(options, task, tasks, lastStatuses, maxAgents)
    return
  }

  task.status = 'running'
  emitStatus(options, task, tasks, lastStatuses, maxAgents)
  const workspaceBefore = captureWorkspaceFileState(options.cwd)

  let result: TaskExecutionResult
  try {
    result = await options.executeTask(task)
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
  emitStatus(options, task, tasks, lastStatuses, maxAgents)
}

export async function runPromptPlan(
  plan: PromptPlan,
  options: RunPromptPlanOptions,
): Promise<RunPromptPlanResult> {
  const config = {
    ...DEFAULT_PROMPT_PLANNING_CONFIG,
    ...resolvePromptPlanningConfig(options.config ?? plan.config),
  }
  const tasks = cloneTasks(plan.tasks)
  const tasksById = new Map(tasks.map(task => [task.id, task]))
  const records = new Map<string, TaskRunRecord>()
  const activeLocks = new Set<string>()
  const running = new Set<Promise<void>>()
  const lastStatuses = new Map<string, NexusTaskStatus>()
  const maxAgentsAllowed = config.parallelAgents ? config.maxAgents : 1
  const maxAgents = usefulAgentCount(tasks, {
    parallelAgents: config.parallelAgents,
    maxAgents: maxAgentsAllowed,
  })
  let maxAgentsUsed = 0

  emitBoard(options, tasks, maxAgentsAllowed)

  while (true) {
    for (const task of tasks) {
      if (task.status === 'pending' && dependenciesFailed(task, tasksById)) {
        task.status = 'needs-context'
        emitStatus(options, task, tasks, lastStatuses, maxAgentsAllowed)
      }
      if (task.status === 'pending' && dependenciesFinished(task, tasksById)) {
        task.status = 'ready'
        emitStatus(options, task, tasks, lastStatuses, maxAgentsAllowed)
      }
    }

    const ready = tasks.filter(
      task =>
        task.status === 'ready' &&
        running.size < maxAgents &&
        !isLocked(task, activeLocks),
    )

    for (const task of ready) {
      if (running.size >= maxAgents) break
      if (isLocked(task, activeLocks)) continue
      acquireLocks(task, activeLocks)
      const promise = runOneTask(
        task,
        tasks,
        options,
        records,
        lastStatuses,
        maxAgentsAllowed,
      ).finally(() => {
        releaseLocks(task, activeLocks)
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
          task.status = 'needs-context'
          records.set(task.id, {
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
            approvalDecisions: approvalDecisionFor(task)
              ? [approvalDecisionFor(task)!]
              : [],
            preVerification: {
              ok: false,
              blocked: true,
              issues: [
                {
                  code: 'unsatisfied_dependencies',
                  message: `${task.id} cannot continue because dependencies did not finish.`,
                  severity: 'error',
                },
              ],
            },
          })
          emitStatus(options, task, tasks, lastStatuses, maxAgentsAllowed)
        }
      }
      return summary(tasks, records, maxAgentsAllowed, maxAgentsUsed)
    }

    await Promise.race(running)
  }
}
