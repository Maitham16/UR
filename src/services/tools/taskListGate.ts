import { getInitialSettings } from '../../utils/settings/settings.js'

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

// Off by default: the gate refused legitimate first writes often enough that
// the friction outweighed the plans it produced. Re-enable per project with
// tasks.requireBeforeChanges.enabled=true.
export const TASK_LIST_GATE_DEFAULTS: TaskListGateConfig = {
  enabled: false,
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
  config?: TaskListGateConfig
}): GateDecision {
  const config = input.config ?? getTaskListGateConfig()
  if (!config.enabled) return { allowed: true }
  if (isTaskListGateExempt(input.toolName)) return { allowed: true }
  const isMutating = input.isMutating ?? isMutatingTool(input.toolName)
  if (!isMutating) return { allowed: true }
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
