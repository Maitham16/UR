import { dirname } from 'node:path'
import { getInitialSettings } from '../../utils/settings/settings.js'
import { expandPath } from '../../utils/path.js'
import {
  hasUnbalancedQuotes,
  tryParseShellCommand,
} from '../../utils/bash/shellQuote.js'

/**
 * Requires a task list before the agent changes anything.
 *
 * Guidance alone does not hold: the system prompt already asks for a task list
 * on multi-step work, and the agent still edits files, runs commands and
 * reports completion with no plan on record — which is exactly when it loses
 * track of what it has and has not done, and starts describing work instead of
 * doing it.
 *
 * So this is a gate, not a reminder. Reads stay open, and a short initial
 * allowance keeps one-shot work lightweight. Once that allowance is consumed,
 * mutations require a plan; delegation and child mutations always require one.
 */
export type TaskListGateConfig = {
  enabled: boolean
  /**
   * Tool calls allowed before ordinary mutations require a plan. Zero would
   * force a task list for every one-shot edit, which trains users to disable
   * the gate. Delegation and child mutations do not consume this allowance.
   */
  freeReads: number
}

export const TASK_LIST_GATE_DEFAULTS: TaskListGateConfig = {
  enabled: true,
  freeReads: 3,
}

/**
 * Tools that change something outside the session: the ones whose results the
 * user has to live with, and the ones worth having a plan for. Task tools are
 * deliberately absent — the gate must never block the fix for itself.
 */
const KNOWN_MUTATING_TOOLS = new Set([
  'Edit',
  'MultiEdit',
  'Write',
  'NotebookEdit',
  'Bash',
  'Shell',
  'PowerShell',
  'Computer',
  'Agent',
  'Task',
  'REPL',
])

const GATE_EXEMPT_TOOLS = new Set([
  // These are the ways to satisfy or inspect the gate. Classifying TaskCreate
  // and TaskUpdate through their default isReadOnly=false would deadlock it.
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TaskGet',
  'TodoWrite',
  // Exiting plan mode is the approval/control transition that precedes
  // implementation, not implementation work itself. The tool's own initial
  // validation still requires live plan mode, so this exemption cannot make a
  // stale second ExitPlanMode call valid.
  'ExitPlanMode',
])

const ALWAYS_REQUIRE_PLAN_TOOLS = new Set([
  // Delegation can mutate through the child process. Letting it consume the
  // trivial-call allowance would make every child mutation bypass the parent
  // gate, so both the canonical name and legacy alias require a real plan.
  'Agent',
  'Task',
])

const TASK_DECOMPOSITION_RECOVERY =
  'For non-trivial work, create one task per cohesive outcome with its own ' +
  'observable done check; keep one task only when the work is genuinely atomic.'

const PLAN_ARTIFACT_MUTATING_TOOLS = new Set([
  'Write',
  'Edit',
  'MultiEdit',
])

function isShellOperator(
  token: unknown,
  operator: string,
): boolean {
  return (
    typeof token === 'object' &&
    token !== null &&
    'op' in token &&
    (token as { op?: unknown }).op === operator
  )
}

/**
 * Recognize only the plan-directory bootstrap emitted in real plan-mode
 * transcripts. FileWrite creates its parent automatically, but weak models
 * sometimes check/create ~/.ur/plans first. That setup belongs to the current
 * plan artifact; it is not implementation work and must not force TaskCreate
 * before plan approval.
 */
function isPlanDirectoryBootstrapForGate(input: {
  toolInput: unknown
  expectedPlanFile: string
}): boolean {
  if (
    typeof input.toolInput !== 'object' ||
    input.toolInput === null
  ) {
    return false
  }
  const candidate = input.toolInput as {
    command?: unknown
    run_in_background?: unknown
    dangerouslyDisableSandbox?: unknown
    _simulatedSedEdit?: unknown
  }
  if (
    typeof candidate.command !== 'string' ||
    candidate.run_in_background === true ||
    candidate.dangerouslyDisableSandbox === true ||
    candidate._simulatedSedEdit !== undefined
  ) {
    return false
  }

  const command = candidate.command
  if (
    command.includes('$') ||
    command.includes('`') ||
    command.includes('\\') ||
    command.includes('\n') ||
    command.includes('\r') ||
    command.includes('\0') ||
    hasUnbalancedQuotes(command)
  ) {
    return false
  }

  const parsed = tryParseShellCommand(command)
  if (!parsed.success) return false
  const tokens = parsed.tokens
  let expectedPlanDirectory: string
  try {
    expectedPlanDirectory = dirname(expandPath(input.expectedPlanFile))
  } catch {
    return false
  }
  const isPlanDirectory = (token: unknown): boolean => {
    if (typeof token !== 'string' || token.trim() === '') return false
    try {
      return expandPath(token) === expectedPlanDirectory
    } catch {
      return false
    }
  }
  const isMkdir =
    tokens.length === 3 &&
    tokens[0] === 'mkdir' &&
    tokens[1] === '-p' &&
    isPlanDirectory(tokens[2])
  if (isMkdir) return true

  const hasSilentStderr =
    tokens[3] === '2' &&
    isShellOperator(tokens[4], '>') &&
    tokens[5] === '/dev/null'
  const guardOperatorIndex = hasSilentStderr ? 6 : 3
  const mkdirIndex = guardOperatorIndex + 1
  const hasGuardedMkdir =
    tokens[0] === 'ls' &&
    tokens[1] === '-la' &&
    isPlanDirectory(tokens[2]) &&
    isShellOperator(tokens[guardOperatorIndex], '||') &&
    tokens[mkdirIndex] === 'mkdir' &&
    tokens[mkdirIndex + 1] === '-p' &&
    isPlanDirectory(tokens[mkdirIndex + 2])
  if (!hasGuardedMkdir) return false

  const afterMkdir = mkdirIndex + 3
  if (tokens.length === afterMkdir) return true
  return (
    tokens.length === afterMkdir + 4 &&
    isShellOperator(tokens[afterMkdir], '&&') &&
    tokens[afterMkdir + 1] === 'ls' &&
    tokens[afterMkdir + 2] === '-la' &&
    isPlanDirectory(tokens[afterMkdir + 3])
  )
}

/**
 * The current session's plan file is itself the planning artifact, so the
 * task-list gate must not block creating/updating it or narrowly bootstrapping
 * its exact parent directory. Match normalized exact paths—not the whole plans
 * directory, a sibling plan, or a shared string prefix.
 */
export function isPlanArtifactMutationForGate(input: {
  toolName: string
  toolInput: unknown
  expectedPlanFile: string
  isPlanMode: boolean
}): boolean {
  if (!input.isPlanMode) return false
  if (input.toolName === 'Bash') {
    return isPlanDirectoryBootstrapForGate({
      toolInput: input.toolInput,
      expectedPlanFile: input.expectedPlanFile,
    })
  }
  if (!PLAN_ARTIFACT_MUTATING_TOOLS.has(input.toolName)) return false
  if (
    typeof input.toolInput !== 'object' ||
    input.toolInput === null ||
    !('file_path' in input.toolInput)
  ) {
    return false
  }
  const filePath = (input.toolInput as { file_path?: unknown }).file_path
  if (typeof filePath !== 'string' || filePath.trim() === '') return false
  try {
    return expandPath(filePath) === expandPath(input.expectedPlanFile)
  } catch {
    // Invalid paths never become a planning exemption.
    return false
  }
}

const LOOPBACK_PREVIEW_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
])

/**
 * A browser preview is an observable verification action, not a workspace
 * mutation. Keep this separate from BashTool.isReadOnly: launching an app is
 * still a side effect that must pass Bash's normal permission flow.
 *
 * This intentionally recognizes only one simple `open <loopback-url>` command.
 * Flags, files, remote URLs, shell expansion, redirection, chaining, simulated
 * edits, backgrounding and sandbox overrides all fail closed.
 */
export function isLocalPreviewOpenForTaskGate(input: {
  toolName: string
  toolInput: unknown
}): boolean {
  if (
    input.toolName !== 'Bash' ||
    typeof input.toolInput !== 'object' ||
    input.toolInput === null
  ) {
    return false
  }

  const candidate = input.toolInput as {
    command?: unknown
    run_in_background?: unknown
    dangerouslyDisableSandbox?: unknown
    _simulatedSedEdit?: unknown
  }
  if (
    typeof candidate.command !== 'string' ||
    candidate.command.trim() === '' ||
    candidate.run_in_background === true ||
    candidate.dangerouslyDisableSandbox === true ||
    candidate._simulatedSedEdit !== undefined
  ) {
    return false
  }

  const command = candidate.command
  // shell-quote preserves command substitutions inside double quotes as text,
  // so reject every expansion form before considering its parsed argv. A
  // blanket backslash rejection also avoids known shell/parser differentials.
  if (
    command.includes('$') ||
    command.includes('`') ||
    command.includes('\\') ||
    command.includes('\n') ||
    command.includes('\r') ||
    command.includes('\0') ||
    hasUnbalancedQuotes(command)
  ) {
    return false
  }

  const parsed = tryParseShellCommand(command)
  if (
    !parsed.success ||
    parsed.tokens.length !== 2 ||
    parsed.tokens.some(token => typeof token !== 'string') ||
    parsed.tokens[0] !== 'open'
  ) {
    return false
  }

  try {
    const url = new URL(parsed.tokens[1] as string)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      LOOPBACK_PREVIEW_HOSTS.has(url.hostname) &&
      url.username === '' &&
      url.password === ''
    )
  } catch {
    return false
  }
}

/**
 * Runtime mutation classification for the task-list gate only. This must not
 * be reused for permission, sandbox, concurrency or planning-child checks.
 */
export function isMutationRequiringTaskList(input: {
  toolName: string
  toolInput: unknown
  isMutating: boolean
}): boolean {
  return (
    input.isMutating &&
    !isLocalPreviewOpenForTaskGate({
      toolName: input.toolName,
      toolInput: input.toolInput,
    })
  )
}

export function getTaskListGateConfig(): TaskListGateConfig {
  const configured = (
    getInitialSettings() as {
      tasks?: { requireBeforeChanges?: Partial<TaskListGateConfig> }
    } | null
  )?.tasks?.requireBeforeChanges
  if (!configured) return TASK_LIST_GATE_DEFAULTS
  return {
    enabled:
      typeof configured.enabled === 'boolean'
        ? configured.enabled
        : TASK_LIST_GATE_DEFAULTS.enabled,
    freeReads:
      typeof configured.freeReads === 'number' &&
      Number.isInteger(configured.freeReads) &&
      configured.freeReads >= 0
        ? configured.freeReads
        : TASK_LIST_GATE_DEFAULTS.freeReads,
  }
}

export function isMutatingTool(toolName: string): boolean {
  return (
    !GATE_EXEMPT_TOOLS.has(toolName) && KNOWN_MUTATING_TOOLS.has(toolName)
  )
}

export function isTaskListGateExempt(toolName: string): boolean {
  return GATE_EXEMPT_TOOLS.has(toolName)
}

export function countActionableTasksForGate(
  tasks: ReadonlyArray<{
    status: string
    metadata?: Record<string, unknown>
  }>,
): number {
  return tasks.filter(
    task =>
      !task.metadata?._internal &&
      (task.status === 'pending' || task.status === 'in_progress'),
  ).length
}

/** Legacy TodoWrite plans satisfy the same mutation gate in headless mode. */
export function countActionableTodosForGate(
  todos: ReadonlyArray<{ status: string }> | null | undefined,
): number {
  return (todos ?? []).filter(
    todo => todo.status === 'pending' || todo.status === 'in_progress',
  ).length
}

export type GateDecision =
  | { allowed: true }
  | { allowed: false; reason: string }

/**
 * Whether this call may proceed.
 *
 * `taskCount` is how many actionable tasks exist for the session and
 * `readsSoFar` is how many tool calls precede this one. Delegation and
 * subagent mutations require an actionable parent task because otherwise the
 * child process becomes an untracked escape from the gate.
 */
export function checkTaskListGate(input: {
  toolName: string
  /** null means the task store could not be read and must fail closed. */
  taskCount: number | null
  /**
   * Total user-visible tasks, including terminal ones. Runtime callers pass
   * this so recovery can distinguish an absent list from a prematurely closed
   * list. Omitted by legacy/direct callers that only know actionable count.
   */
  totalTaskCount?: number | null
  readsSoFar: number
  isSubagent: boolean
  /**
   * Runtime classification from the resolved tool's isReadOnly(input).
   * The name set above is only a conservative fallback for direct callers.
   */
  isMutating?: boolean
  /**
   * True only for an exact current-session plan file. The plan artifact must
   * be writable before TaskCreate without opening ordinary workspace writes.
   */
  isPlanArtifactMutation?: boolean
  /** Exact task-list tool available in this runtime (TaskCreate or TodoWrite). */
  taskPlanningToolName?: string
  config?: TaskListGateConfig
}): GateDecision {
  const config = input.config ?? getTaskListGateConfig()
  if (!config.enabled) return { allowed: true }
  if (isTaskListGateExempt(input.toolName)) return { allowed: true }
  const isMutating = input.isMutating ?? isMutatingTool(input.toolName)
  if (!isMutating) return { allowed: true }
  if (input.isPlanArtifactMutation) return { allowed: true }
  if (input.taskCount !== null && input.taskCount > 0) {
    return { allowed: true }
  }
  if (input.taskCount === null) {
    const taskTool = input.taskPlanningToolName ?? 'TaskCreate'
    return {
      allowed: false,
      reason:
        `The task list could not be read, so ${input.toolName} was not allowed ` +
        `to change state without a verifiable plan. Use ${taskTool} to create ` +
        `or repair the task list, then retry this call. ` +
        `${TASK_DECOMPOSITION_RECOVERY} ` +
        `Disable with ` +
        `tasks.requireBeforeChanges.enabled=false in settings.`,
    }
  }
  if (
    input.isSubagent ||
    ALWAYS_REQUIRE_PLAN_TOOLS.has(input.toolName)
  ) {
    const taskTool = input.taskPlanningToolName ?? 'TaskCreate'
    const terminalContext =
      input.totalTaskCount !== null &&
      input.totalTaskCount !== undefined &&
      input.totalTaskCount > 0
        ? ' The existing task list contains only terminal tasks.'
        : ''
    return {
      allowed: false,
      reason:
        `No actionable parent task exists for ${input.toolName}.` +
        `${terminalContext} Call ${taskTool} before delegating or changing ` +
        `state, then retry this call. ` +
        `${TASK_DECOMPOSITION_RECOVERY} ` +
        `Disable with tasks.requireBeforeChanges.enabled=false in settings.`,
    }
  }
  if (input.readsSoFar < config.freeReads) return { allowed: true }
  const taskTool = input.taskPlanningToolName ?? 'TaskCreate'
  const hasTerminalTaskList =
    input.totalTaskCount !== null &&
    input.totalTaskCount !== undefined &&
    input.totalTaskCount > 0
  const taskState = hasTerminalTaskList
    ? 'The task list exists, but every tracked task is terminal, so no actionable task remains'
    : 'No actionable task exists'
  const recovery =
    taskTool === 'TodoWrite'
      ? 'Call TodoWrite first to add a cohesive remaining todo or move the relevant todo back to pending/in_progress'
      : taskTool === 'TaskCreate'
        ? 'Call TaskCreate first to add a cohesive remaining task, or call TaskUpdate to move the relevant task back to pending/in_progress'
        : `Use ${taskTool} first to add or reopen a cohesive pending/in_progress task`
  return {
    allowed: false,
    reason:
      `${taskState}, and ${input.toolName} changes workspace state. ` +
      `${recovery}, then retry this call. Keep preview, launch, and ` +
      `verification work actionable until its observable check has actually ` +
      `run; do not mark that task complete before the check. ` +
      `${TASK_DECOMPOSITION_RECOVERY} Reads are unrestricted, so investigate ` +
      `as much as you need before writing the list. ` +
      `Disable with tasks.requireBeforeChanges.enabled=false in settings.`,
  }
}
