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
    return `For every actionable request with two or more distinct implementation or verification outcomes, you MUST use ${TASK_CREATE_TOOL_NAME} before making changes; do not omit the task list. Create dependency-ordered tasks, one per concrete outcome, and declare independent branches without dependencies so they can run in parallel. A new user request starts a fresh list unless the user explicitly asks to add to the current list. Skip task creation only for a direct answer or genuinely single-step action. Use ${TASK_UPDATE_TOOL_NAME} to mark each unblocked task in_progress when work starts and completed immediately after implementation and relevant verification succeed; use failed for attempted work that did not finish, skipped only for explicitly inapplicable work, and leave dependency-blocked work open with its blocker recorded.${canList ? ` Use ${TASK_LIST_TOOL_NAME} to select the next unblocked task; when all work succeeds, show the final list with every task completed before finishing.` : ''}`
  }

  if (canUpdate) {
    return `Keep assigned tasks current with ${TASK_UPDATE_TOOL_NAME}: mark the task in_progress when starting, completed only after implementation and relevant verification succeed, and leave blocked or partial work open with its blocker recorded.${canList ? ` Use ${TASK_LIST_TOOL_NAME} to select the next unblocked task.` : ''}`
  }

  if (canCreate) {
    return `For every actionable request with two or more distinct outcomes, you MUST use ${TASK_CREATE_TOOL_NAME} before implementation to record concrete outcomes and their dependency order. A new user request starts a fresh list unless the user explicitly asks to append to the current one; skip the list only for a direct answer or genuinely single-step action.`
  }

  if (enabledTools.has(TODO_WRITE_TOOL_NAME)) {
    return `Track multi-step work with ${TODO_WRITE_TOOL_NAME}. Keep items dependency-ordered and mark each item completed immediately after its implementation and relevant verification succeed.`
  }

  return null
}
