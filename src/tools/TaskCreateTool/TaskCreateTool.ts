import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import {
  executeTaskCreatedHooks,
  getTaskCreatedHookMessage,
} from '../../utils/hooks.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  createTask,
  deleteTask,
  getTaskListId,
  isTodoV2Enabled,
  retireCompletedTaskList,
  updateTaskWithDependencies,
} from '../../utils/tasks.js'
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
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

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
    return true
  },
  toAutoClassifierInput(input) {
    return input.subject
  },
  renderToolUseMessage() {
    return null
  },
  async call(
    {
      subject,
      description,
      activeForm,
      metadata,
      blocks,
      blockedBy,
      addBlocks,
      addBlockedBy,
    },
    context,
  ) {
    const initialBlocks = [...new Set([...(blocks ?? []), ...(addBlocks ?? [])])]
    const initialBlockedBy = [
      ...new Set([...(blockedBy ?? []), ...(addBlockedBy ?? [])]),
    ]
    const taskListId = getTaskListId()
    // A finished list is history, not active work. useTasksV2 clears it on a
    // 5s hide timer, but a create that lands inside that window — or after the
    // timer was cancelled — appended to the completed list, so the new work
    // arrived pre-populated with ticked items and the progress count was wrong
    // from the first task. Retiring it here makes the rule deterministic
    // instead of timing-dependent.
    await retireCompletedTaskList(taskListId)
    const taskId = await createTask(taskListId, {
      subject,
      description,
      activeForm,
      status: 'pending',
      owner: undefined,
      // Relationships are written through blockTask below so both tasks keep
      // reciprocal blocks/blockedBy edges. Storing only this side produced
      // contradictory TaskGet, TaskList and claim behaviour.
      blocks: [],
      blockedBy: [],
      metadata,
    })

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
    ]
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
        const field = dependencies.find(
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

    // Auto-expand task list when creating tasks
    context.setAppState(prev => {
      if (prev.expandedView === 'tasks') return prev
      return { ...prev, expandedView: 'tasks' as const }
    })

    return {
      data: {
        task: {
          id: taskId,
          subject,
        },
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
