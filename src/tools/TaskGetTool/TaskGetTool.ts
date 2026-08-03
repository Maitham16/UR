import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  getTask,
  getTaskListId,
  isTodoV2Enabled,
  listTasks,
  TaskStatusSchema,
} from '../../utils/tasks.js'
import { TASK_GET_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    taskId: z.string().describe('The ID of the task to retrieve'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    task: z
      .object({
        id: z.string(),
        subject: z.string(),
        description: z.string(),
        status: TaskStatusSchema(),
        blocks: z.array(z.string()),
        blockedBy: z.array(z.string()),
      })
      .nullable(),
    // Present only when the task was not found, so the caller can correct the
    // id in one step instead of retrying the same one.
    availableTaskIds: z.array(z.string()).optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const TaskGetTool = buildTool({
  name: TASK_GET_TOOL_NAME,
  searchHint: 'retrieve a task by ID',
  maxResultSizeChars: 100_000,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'TaskGet'
  },
  shouldDefer: false,
  isEnabled() {
    return isTodoV2Enabled()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.taskId
  },
  renderToolUseMessage() {
    return null
  },
  async call({ taskId }) {
    const taskListId = getTaskListId()

    const task = await getTask(taskListId, taskId)

    if (!task) {
      return {
        data: {
          task: null,
          availableTaskIds: (await listTasks(taskListId)).map(entry => entry.id),
        },
      }
    }

    return {
      data: {
        task: {
          id: task.id,
          subject: task.subject,
          description: task.description,
          status: task.status,
          blocks: task.blocks,
          blockedBy: task.blockedBy,
        },
      },
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const { task, availableTaskIds } = content as Output
    if (!task) {
      // Naming what exists turns a dead end into a correctable call. A bare
      // "Task not found" said nothing about whether the id was wrong or the
      // list had moved on, so the usual response was to retry it unchanged.
      const known = (availableTaskIds ?? []).map(id => `#${id}`)
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content:
          known.length > 0
            ? `Task not found. Existing tasks: ${known.join(', ')}.`
            : 'Task not found. The task list is empty — create the task before reading it.',
      }
    }

    const lines = [
      `Task #${task.id}: ${task.subject}`,
      `Status: ${task.status}`,
      `Description: ${task.description}`,
    ]

    if (task.blockedBy.length > 0) {
      lines.push(`Blocked by: ${task.blockedBy.map(id => `#${id}`).join(', ')}`)
    }
    if (task.blocks.length > 0) {
      lines.push(`Blocks: ${task.blocks.map(id => `#${id}`).join(', ')}`)
    }

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: lines.join('\n'),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
