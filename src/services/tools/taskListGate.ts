import { getInitialSettings } from '../../utils/settings/settings.js'
import { expandPath } from '../../utils/path.js'

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
])

const ALWAYS_REQUIRE_PLAN_TOOLS = new Set([
  // Delegation can mutate through the child process. Letting it consume the
  // trivial-call allowance would make every child mutation bypass the parent
  // gate, so both the canonical name and legacy alias require a real plan.
  'Agent',
  'Task',
])

const PLAN_ARTIFACT_MUTATING_TOOLS = new Set([
  'Write',
  'Edit',
  'MultiEdit',
])

/**
 * The current session's plan file is itself the planning artifact, so the
 * task-list gate must not block creating or updating it. Match the exact
 * normalized file—not the whole plans directory or a shared string prefix.
 */
export function isPlanArtifactMutationForGate(input: {
  toolName: string
  toolInput: unknown
  expectedPlanFile: string
  isPlanMode: boolean
}): boolean {
  if (!input.isPlanMode) return false
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
    return {
      allowed: false,
      reason:
        `The task list could not be read, so ${input.toolName} was not allowed ` +
        `to change state without a verifiable plan. Retry TaskList or ` +
        `TaskCreate, then retry this call. Disable with ` +
        `tasks.requireBeforeChanges.enabled=false in settings.`,
    }
  }
  if (
    input.isSubagent ||
    ALWAYS_REQUIRE_PLAN_TOOLS.has(input.toolName)
  ) {
    return {
      allowed: false,
      reason:
        `No actionable parent task exists for ${input.toolName}. Call ` +
        `TaskCreate before delegating or changing state, then retry this call. ` +
        `Disable with tasks.requireBeforeChanges.enabled=false in settings.`,
    }
  }
  if (input.readsSoFar < config.freeReads) return { allowed: true }
  return {
    allowed: false,
    reason:
      `No task list exists, and ${input.toolName} changes the workspace. ` +
      `Call TaskCreate first with the steps you intend to take, then retry ` +
      `this call. Reads are unrestricted, so investigate as much as you need ` +
      `before writing the list. ` +
      `Disable with tasks.requireBeforeChanges.enabled=false in settings.`,
  }
}
