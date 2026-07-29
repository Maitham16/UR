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
 * So this is a gate, not a reminder. Reads stay open, because the agent needs
 * to look around before it can write a sensible list; the first *mutating*
 * call is what requires a plan to exist.
 */
export type TaskListGateConfig = {
  enabled: boolean
  /**
   * Read-only calls allowed before the gate applies at all. Zero would force a
   * task list for a one-line question, which trains the user to switch it off.
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
const MUTATING_TOOLS = new Set([
  'Edit',
  'MultiEdit',
  'Write',
  'NotebookEdit',
  'Bash',
  'Shell',
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
  return MUTATING_TOOLS.has(toolName)
}

export type GateDecision =
  | { allowed: true }
  | { allowed: false; reason: string }

/**
 * Whether this call may proceed.
 *
 * `taskCount` is how many tasks exist for the session, `readsSoFar` how many
 * tool calls have already run. A subagent is exempt: it executes one delegated
 * step and does not own the parent's plan.
 */
export function checkTaskListGate(input: {
  toolName: string
  taskCount: number
  readsSoFar: number
  isSubagent: boolean
  config?: TaskListGateConfig
}): GateDecision {
  const config = input.config ?? getTaskListGateConfig()
  if (!config.enabled) return { allowed: true }
  if (input.isSubagent) return { allowed: true }
  if (!isMutatingTool(input.toolName)) return { allowed: true }
  if (input.taskCount > 0) return { allowed: true }
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
