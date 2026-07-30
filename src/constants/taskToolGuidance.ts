import { TASK_CREATE_TOOL_NAME } from '../tools/TaskCreateTool/constants.js'
import { TASK_LIST_TOOL_NAME } from '../tools/TaskListTool/constants.js'
import { TASK_UPDATE_TOOL_NAME } from '../tools/TaskUpdateTool/constants.js'
import { TODO_WRITE_TOOL_NAME } from '../tools/TodoWriteTool/constants.js'
import { AGENT_TOOL_NAME } from '../tools/AgentTool/constants.js'

export function getTaskToolGuidance(
  enabledTools: ReadonlySet<string>,
): string | null {
  const canCreate = enabledTools.has(TASK_CREATE_TOOL_NAME)
  const canUpdate = enabledTools.has(TASK_UPDATE_TOOL_NAME)
  const canList = enabledTools.has(TASK_LIST_TOOL_NAME)
  const canDelegate = enabledTools.has(AGENT_TOOL_NAME)
  const taskFirstSequence =
    `Before any non-trivial state-changing call—even for one feature-rich ` +
    `file—finish ${TASK_CREATE_TOOL_NAME} setup, inspect its successful ` +
    `results, then use ${TASK_UPDATE_TOOL_NAME} to mark the selected task ` +
    `in_progress and inspect that success before dependent Write, Edit, ` +
    `mutating shell, ${AGENT_TOOL_NAME}, Task, or another state-changing call. ` +
    `Never batch task setup ` +
    `with the work it enables. If earlier tasks are all terminal and new work ` +
    `arrives, create a new outcome task or reopen the relevant task first.`
  const decomposition =
    'For non-trivial work, use one task per cohesive outcome with its own observable done check; never hide separately completable deliverables in one omnibus task. Keep genuinely atomic work as one task—do not split by file, tool call, or tiny mechanical step. Make real dependencies explicit and leave unrelated tasks unblocked.'
  const parallel = canDelegate
    ? ` If delegating, launch mutually independent tasks through ${AGENT_TOOL_NAME} in parallel only when they have no conflicting shared mutations; keep dependent or conflicting work sequential.`
    : ''

  if (canCreate && canUpdate) {
    return `${taskFirstSequence} Track multi-step work with ${TASK_CREATE_TOOL_NAME} and ${TASK_UPDATE_TOOL_NAME}. ${decomposition}${parallel} Create the complete dependency graph before implementation; mark each task completed immediately after its implementation and relevant verification succeed; leave blocked or partial work open with its blocker recorded.${canList ? ` Use ${TASK_LIST_TOOL_NAME} to select the next unblocked task.` : ''}`
  }

  if (enabledTools.has(TODO_WRITE_TOOL_NAME)) {
    return `Before any non-trivial state change—even for one feature-rich file—finish ${TODO_WRITE_TOOL_NAME} and inspect its successful result before a dependent state-changing call; never batch todo setup with the work it enables. Track multi-step work with ${TODO_WRITE_TOOL_NAME}. ${decomposition} Keep items dependency-ordered and mark each item completed immediately after its implementation and relevant verification succeed. If all items are terminal and new work arrives, add a pending/in_progress outcome first.`
  }

  if (canUpdate) {
    return `Keep assigned tasks current with ${TASK_UPDATE_TOOL_NAME}: mark the task in_progress when starting, completed only after implementation and relevant verification succeed, and leave blocked or partial work open with its blocker recorded.${canList ? ` Use ${TASK_LIST_TOOL_NAME} to select the next unblocked task.` : ''}`
  }

  if (canCreate) {
    return `For non-trivial state changes, finish ${TASK_CREATE_TOOL_NAME} and inspect its successful result before Write, Edit, mutating shell, ${AGENT_TOOL_NAME}, Task, or another state-changing call; never batch task creation with the work it enables. ${decomposition}${parallel}`
  }

  return null
}
