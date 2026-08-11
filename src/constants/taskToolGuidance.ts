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
    return `UR uses a strict-hybrid task policy. Before the first mutation, you MUST use ${TASK_CREATE_TOOL_NAME} for 2+ distinct requested outcomes, enumerated or sequenced work, multiple independently verifiable deliverables, plan-mode implementation, delegation or parallel agents, dependency ordering, project-sized builds/refactors, and release, publishing, deployment, migration, security, credential, permission, sandbox, production, or other high-risk work. An explicit user request for tasks always wins. Only a genuinely atomic, low-risk change with one outcome may proceed directly; informational answers, acknowledgements, and small corrections need no board. Read-only investigation is always allowed before planning. Decompose tracked work into 2-8 bounded outcomes (never more than 12), each with one observable result, likely file scope, and acceptance evidence; never copy the raw user prompt as a task title. Create tasks first without guessed or forward dependency IDs. After each real ID is returned, use ${TASK_UPDATE_TOOL_NAME} to add dependencies only to tasks that already exist; never reference a future task, and never create a self-dependency. Keep the final graph dependency-ordered; independent branches stay dependency-free. If the user interrupts while tasks are pending or in progress, inspect the active list, preserve still-relevant work, update the affected task, add a task only for a genuinely distinct new outcome, and mark superseded work skipped rather than starting from an empty list. Mark each unblocked task in_progress when work starts and completed immediately after implementation and relevant verification succeed; use failed for attempted work that did not finish, skipped only for explicitly inapplicable work, and leave dependency-blocked work open with its blocker recorded.${canList ? ` Use ${TASK_LIST_TOOL_NAME} after every interruption and to select the next unblocked task; when all work succeeds, show the final list with every task completed before finishing.` : ''}`
  }

  if (canUpdate) {
    return `Keep assigned tasks current with ${TASK_UPDATE_TOOL_NAME}: mark the task in_progress when starting, completed only after implementation and relevant verification succeed, and leave blocked or partial work open with its blocker recorded.${canList ? ` Use ${TASK_LIST_TOOL_NAME} to select the next unblocked task.` : ''}`
  }

  if (canCreate) {
    return `Use ${TASK_CREATE_TOOL_NAME} before mutation for 2+ distinct outcomes, sequenced work, project-sized changes, delegation, dependencies, releases/deployments/migrations, security-sensitive work, or an explicit task-list request. Only a genuinely atomic low-risk change may proceed directly. A tracked request should have 2-8 bounded outcomes (never more than 12). Never copy the raw prompt as a task title. Create tasks without guessed or forward IDs; dependencies may name only tasks whose real IDs have already been returned. Preserve pending or in-progress work after an interruption, update affected work, and add only genuinely distinct new outcomes.`
  }

  if (enabledTools.has(TODO_WRITE_TOOL_NAME)) {
    return `Track multi-step work with ${TODO_WRITE_TOOL_NAME}. Keep items dependency-ordered and mark each item completed immediately after its implementation and relevant verification succeed.`
  }

  return null
}
