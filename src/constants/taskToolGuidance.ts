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
  const decomposition =
    'For non-trivial work, use one task per cohesive outcome with its own observable done check; never hide separately completable deliverables in one omnibus task. Keep genuinely atomic work as one task—do not split by file, tool call, or tiny mechanical step. Make real dependencies explicit and leave unrelated tasks unblocked.'
  const parallel = canDelegate
    ? ` If delegating, launch mutually independent tasks through ${AGENT_TOOL_NAME} in parallel only when they have no conflicting shared mutations; keep dependent or conflicting work sequential.`
    : ''

  if (canCreate && canUpdate) {
    return `Track multi-step work with ${TASK_CREATE_TOOL_NAME} and ${TASK_UPDATE_TOOL_NAME}. ${decomposition}${parallel} Create the complete dependency graph before implementation; mark each task in_progress when its work starts and completed immediately after its implementation and relevant verification succeed; leave blocked or partial work open with its blocker recorded.${canList ? ` Use ${TASK_LIST_TOOL_NAME} to select the next unblocked task.` : ''}`
  }

  if (canUpdate) {
    return `Keep assigned tasks current with ${TASK_UPDATE_TOOL_NAME}: mark the task in_progress when starting, completed only after implementation and relevant verification succeed, and leave blocked or partial work open with its blocker recorded.${canList ? ` Use ${TASK_LIST_TOOL_NAME} to select the next unblocked task.` : ''}`
  }

  if (canCreate) {
    return `For multi-step work, use ${TASK_CREATE_TOOL_NAME} before implementation. ${decomposition}${parallel}`
  }

  if (enabledTools.has(TODO_WRITE_TOOL_NAME)) {
    return `Track multi-step work with ${TODO_WRITE_TOOL_NAME}. ${decomposition} Keep items dependency-ordered and mark each item completed immediately after its implementation and relevant verification succeed.`
  }

  return null
}
