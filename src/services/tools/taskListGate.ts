import { getInitialSettings } from '../../utils/settings/settings.js'
import { isAutomaticPromptTask } from '../../utils/tasks.js'

/**
 * Requires a task list before the agent changes anything.
 *
 * Guidance alone does not hold: the system prompt already asks for a task list
 * on multi-step work, and the agent still edits files, runs commands and
 * reports completion with no plan on record — which is exactly when it loses
 * track of what it has and has not done, and starts describing work instead of
 * doing it.
 *
 * So this is a gate, not a reminder. Reads stay open. A deterministic turn
 * classifier keeps atomic work direct and requires tracking for substantial or
 * risky work; delegation and child mutations always require a parent task.
 */
export type TaskListGateConfig = {
  enabled: boolean
  /**
   * Compatibility allowance used only when turn complexity is unavailable.
   * Zero explicitly forces a task list before every mutation. Delegation and
   * classified multi-step turns never consume this allowance.
   */
  freeReads: number
}

// Strict hybrid by default: classified multi-step/risky turns are enforced,
// while a positively classified atomic turn stays direct. Callers without a
// turn classification retain the bounded compatibility allowance.
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
      !isAutomaticPromptTask(task) &&
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
  /** Deterministic classification of the active user turn. */
  requiresTaskList?: boolean
  /** Human-readable classifier reason included in recovery guidance. */
  requirementReason?: string
  /** False when the current tool profile cannot satisfy this gate. */
  taskListWriterAvailable?: boolean
  config?: TaskListGateConfig
}): GateDecision {
  const config = input.config ?? getTaskListGateConfig()
  if (!config.enabled) return { allowed: true }
  // Tool profiles may intentionally omit TaskCreate. Never install a gate the
  // active profile has no way to satisfy.
  if (input.taskListWriterAvailable === false) return { allowed: true }
  if (isTaskListGateExempt(input.toolName)) return { allowed: true }
  const isMutating = input.isMutating ?? isMutatingTool(input.toolName)
  if (!isMutating) return { allowed: true }
  if (input.taskCount !== null && input.taskCount > 0) {
    return { allowed: true }
  }

  const inherentlyRequiresTaskList =
    input.isSubagent || ALWAYS_REQUIRE_PLAN_TOOLS.has(input.toolName)
  const classifiedRequirement = input.requiresTaskList === true
  const forceEveryMutation = config.freeReads === 0
  const unclassifiedAllowanceExpired =
    input.requiresTaskList === undefined && input.readsSoFar >= config.freeReads
  const gateRequired =
    inherentlyRequiresTaskList ||
    classifiedRequirement ||
    forceEveryMutation ||
    unclassifiedAllowanceExpired
  const requirementContext = input.requirementReason
    ? ` This turn requires task tracking because it contains ${input.requirementReason}.`
    : ''
  const planningRecovery =
    input.requirementReason === 'planning workflow'
      ? ' EnterPlanMode and plan updates do not create the visible task list.'
      : ''

  // A missing/corrupt task store cannot prove whether an actionable task
  // exists. Keep the established fail-closed behavior for every mutation.
  if (input.taskCount === null) {
    return {
      allowed: false,
      reason:
        `The task list could not be read, so ${input.toolName} was not allowed ` +
        `to change state without a verifiable plan.${requirementContext}${planningRecovery} Retry TaskList or ` +
        `TaskCreate, then retry this call. Disable with ` +
        `tasks.requireBeforeChanges.enabled=false in settings.`,
    }
  }

  // A turn positively classified as one atomic action remains direct no
  // matter how much read-only investigation preceded its mutation. This is
  // the distinction the old call-count-only gate could not make.
  if (!gateRequired) return { allowed: true }
  if (inherentlyRequiresTaskList) {
    return {
      allowed: false,
      reason:
        `No actionable parent task exists for ${input.toolName}. Call ` +
        `TaskCreate before delegating or changing state, then retry this call. ` +
        `Disable with tasks.requireBeforeChanges.enabled=false in settings.`,
    }
  }
  return {
    allowed: false,
    reason:
      `No task list exists, and ${input.toolName} changes the workspace. ` +
      `${requirementContext.trim()}${requirementContext ? ' ' : ''}` +
      `${planningRecovery.trim()}${planningRecovery ? ' ' : ''}` +
      `Call TaskCreate first with the steps you intend to take, then retry ` +
      `this call. Reads are unrestricted, so investigate as much as you need ` +
      `before writing the list. ` +
      `Disable with tasks.requireBeforeChanges.enabled=false in settings.`,
  }
}
