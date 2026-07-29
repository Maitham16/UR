import { TASK_CREATE_TOOL_NAME } from '../tools/TaskCreateTool/constants.js'
import { TASK_LIST_TOOL_NAME } from '../tools/TaskListTool/constants.js'
import { TASK_UPDATE_TOOL_NAME } from '../tools/TaskUpdateTool/constants.js'
import { TODO_WRITE_TOOL_NAME } from '../tools/TodoWriteTool/constants.js'

export function getTaskToolGuidance(
  enabledTools: ReadonlySet<string>,
): string | null {
  const canCreate = enabledTools.has(TASK_CREATE_TOOL_NAME)
  const canUpdate = enabledTools.has(TASK_UPDATE_TOOL_NAME)
  const canList = enabledTools.has(TASK_LIST_TOOL_NAME)

  if (canCreate && canUpdate) {
    return `Track multi-step work with ${TASK_CREATE_TOOL_NAME} and ${TASK_UPDATE_TOOL_NAME}: create dependency-ordered tasks for the concrete outcomes before implementation; mark one unblocked task in_progress when starting it; mark it completed immediately after implementation and relevant verification succeed; leave blocked or partial work open with its blocker recorded.${canList ? ` Use ${TASK_LIST_TOOL_NAME} to select the next unblocked task.` : ''}`
  }

  if (canUpdate) {
    return `Keep assigned tasks current with ${TASK_UPDATE_TOOL_NAME}: mark the task in_progress when starting, completed only after implementation and relevant verification succeed, and leave blocked or partial work open with its blocker recorded.${canList ? ` Use ${TASK_LIST_TOOL_NAME} to select the next unblocked task.` : ''}`
  }

  if (canCreate) {
    return `For multi-step work, use ${TASK_CREATE_TOOL_NAME} before implementation to record concrete outcomes and their dependency order.`
  }

  if (enabledTools.has(TODO_WRITE_TOOL_NAME)) {
    return `Track multi-step work with ${TODO_WRITE_TOOL_NAME}. Keep items dependency-ordered and mark each item completed immediately after its implementation and relevant verification succeed.`
  }

  return null
}
