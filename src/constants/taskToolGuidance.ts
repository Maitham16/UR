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
    return `For every actionable request, you MUST use ${TASK_CREATE_TOOL_NAME} to maintain the visible task list; do not omit it, even for a single implementation action. Decompose a large request into 2-8 bounded outcomes (never more than 12), each with one observable result, likely file scope, and acceptance evidence. Create tasks first without guessed or forward dependency IDs. After each real ID is returned, use ${TASK_UPDATE_TOOL_NAME} to add dependencies only to tasks that already exist; never reference a future task, and never create a self-dependency. Keep the final graph dependency-ordered; independent branches stay dependency-free. If the user interrupts with new instructions while tasks are pending or in progress, inspect the active list, preserve still-relevant work, add or update the new requirement immediately, and mark superseded work skipped rather than starting from an empty list. Skip task tools only for non-actionable conversation or a direct informational answer with no work to perform. Mark each unblocked task in_progress when work starts and completed immediately after implementation and relevant verification succeed; use failed for attempted work that did not finish, skipped only for explicitly inapplicable work, and leave dependency-blocked work open with its blocker recorded.${canList ? ` Use ${TASK_LIST_TOOL_NAME} after every interruption and to select the next unblocked task; when all work succeeds, show the final list with every task completed before finishing.` : ''}`
  }

  if (canUpdate) {
    return `Keep assigned tasks current with ${TASK_UPDATE_TOOL_NAME}: mark the task in_progress when starting, completed only after implementation and relevant verification succeed, and leave blocked or partial work open with its blocker recorded.${canList ? ` Use ${TASK_LIST_TOOL_NAME} to select the next unblocked task.` : ''}`
  }

  if (canCreate) {
    return `For every actionable request, maintain the visible list with ${TASK_CREATE_TOOL_NAME}; a large request should have 2-8 bounded outcomes (never more than 12), while a single implementation action still gets one task. Create tasks without guessed or forward IDs; dependencies may name only tasks whose real IDs have already been returned. Preserve pending or in-progress work after an interruption and add the new instruction to that active list. Skip task creation only for non-actionable conversation or a direct informational answer.`
  }

  if (enabledTools.has(TODO_WRITE_TOOL_NAME)) {
    return `Track multi-step work with ${TODO_WRITE_TOOL_NAME}. Keep items dependency-ordered and mark each item completed immediately after its implementation and relevant verification succeed.`
  }

  return null
}
