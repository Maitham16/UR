import { z } from 'zod/v4'
import { buildTool, type ToolDef, type ToolUseContext } from '../../Tool.js'
import {
  executeTaskCreatedHooks,
  getTaskCreatedHookMessage,
} from '../../utils/hooks.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  createTask,
  createTaskForRun,
  deleteTask,
  getTaskListId,
  isTodoV2Enabled,
  type Task,
  updateTaskWithDependencies,
} from '../../utils/tasks.js'
import {
  getTaskListRunContext,
  getTaskListRunFromMessages,
} from '../../utils/taskListRunContext.js'
import { getAgentName, getTeamName } from '../../utils/teammate.js'
import { TASK_CREATE_TOOL_NAME } from './constants.js'
import { DESCRIPTION, getPrompt } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    subject: z.string().describe('A brief title for the task'),
    description: z.string().describe('What needs to be done'),
    activeForm: z
      .string()
      .optional()
      .describe(
        'Present continuous form shown in spinner when in_progress (e.g., "Running tests")',
      ),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Arbitrary metadata to attach to the task'),
    blocks: z
      .array(z.string())
      .optional()
      .describe('Task IDs that this task blocks at creation time'),
    blockedBy: z
      .array(z.string())
      .optional()
      .describe('Task IDs that block this task at creation time'),
    addBlocks: z
      .array(z.string())
      .optional()
      .describe('Alias for blocks, accepted for compatibility with TaskUpdate'),
    addBlockedBy: z
      .array(z.string())
      .optional()
      .describe('Alias for blockedBy, accepted for compatibility with TaskUpdate'),
    addToCurrentList: z
      .boolean()
      .optional()
      .describe(
        'Set true only when the user explicitly asks to append to the current task list',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
export type TaskCreateInput = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    task: z.object({
      id: z.string(),
      subject: z.string(),
    }),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

/**
 * Create one semantic task through the canonical lifecycle. Plan approval uses
 * this same path so synchronized tasks retain generation handling, hooks, and
 * immediate UI refresh instead of becoming a second task implementation.
 */
export async function createTaskFromInput(
  {
    subject,
    description,
    activeForm,
    metadata,
    blocks,
    blockedBy,
    addBlocks,
    addBlockedBy,
    addToCurrentList,
  }: TaskCreateInput,
  context: ToolUseContext,
): Promise<{ id: string; subject: string }> {
  const initialBlocks = [...new Set([...(blocks ?? []), ...(addBlocks ?? [])])]
  const initialBlockedBy = [
    ...new Set([...(blockedBy ?? []), ...(addBlockedBy ?? [])]),
  ]
  const taskListId = getTaskListId()
  // REPL turns carry an async-local generation. Non-interactive main-thread
  // callers fall back to the latest human message UUID. Subagents without an
  // inherited turn deliberately append to the shared list rather than
  // retiring coordinator work.
  const run =
    getTaskListRunContext() ??
    (context.agentId
      ? undefined
      : getTaskListRunFromMessages(context.messages ?? []))
  const taskData: Omit<Task, 'id'> = {
    subject,
    description,
    activeForm,
    status: 'pending',
    owner: undefined,
    // Relationships are written through updateTaskWithDependencies below so
    // both tasks keep reciprocal blocks/blockedBy edges.
    blocks: [],
    blockedBy: [],
    metadata,
  }
  const taskId = run
    ? await createTaskForRun(taskListId, run.generationId, taskData, {
        appendToCurrent: run.appendToCurrent || addToCurrentList === true,
      })
    : await createTask(taskListId, taskData)

  const dependencies = [
    ...initialBlocks.map(targetId => ({
      fromTaskId: taskId,
      toTaskId: targetId,
      field: 'blocks',
    })),
    ...initialBlockedBy.map(blockerId => ({
      fromTaskId: blockerId,
      toTaskId: taskId,
      field: 'blockedBy',
    })),
  ].filter(edge => edge.fromTaskId !== edge.toTaskId)
  const dependencyResult = await updateTaskWithDependencies(
    taskListId,
    taskId,
    {},
    dependencies,
  )
  if (dependencyResult.success === false) {
    const dependency = dependencyResult.dependency
    await deleteTask(taskListId, taskId)
    if (dependency) {
      const field =
        dependencies.find(
          candidate =>
            candidate.fromTaskId === dependency.fromTaskId &&
            candidate.toTaskId === dependency.toTaskId,
        )?.field ?? 'dependency'
      throw new Error(
        `Invalid ${field} dependency ` +
          `#${dependency.fromTaskId} -> #${dependency.toTaskId}: ` +
          dependencyResult.reason,
      )
    }
    throw new Error(
      `Failed to create task dependencies: ${dependencyResult.reason}`,
    )
  }

  const blockingErrors: string[] = []
  const generator = executeTaskCreatedHooks(
    taskId,
    subject,
    description,
    getAgentName(),
    getTeamName(),
    undefined,
    context?.abortController?.signal,
    undefined,
    context,
  )
  for await (const result of generator) {
    if (result.blockingError) {
      blockingErrors.push(getTaskCreatedHookMessage(result.blockingError))
    }
  }

  if (blockingErrors.length > 0) {
    await deleteTask(taskListId, taskId)
    throw new Error(blockingErrors.join('\n'))
  }

  context.setAppState(prev =>
    prev.expandedView === 'tasks'
      ? prev
      : { ...prev, expandedView: 'tasks' as const },
  )
  return { id: taskId, subject }
}

export const TaskCreateTool = buildTool({
  name: TASK_CREATE_TOOL_NAME,
  searchHint: 'create a task in the task list',
  maxResultSizeChars: 100_000,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return getPrompt()
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'TaskCreate'
  },
  shouldDefer: false,
  isEnabled() {
    return isTodoV2Enabled()
  },
  isConcurrencySafe() {
    // Calls in one model response refer to the consecutive IDs implied by
    // their emission order. The filesystem allocator itself is locked, but a
    // parallel batch can acquire that lock in a different order and attach
    // every dependency to the wrong task (or turn it into a self-edge).
    return false
  },
  toAutoClassifierInput(input) {
    return input.subject
  },
  renderToolUseMessage() {
    return null
  },
  async call(
    input,
    context,
  ) {
    const task = await createTaskFromInput(input, context)

    return {
      data: {
        task,
      },
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const { task } = content as Output
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Task #${task.id} created successfully: ${task.subject}`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
