import { expect, test } from 'bun:test'
import { TaskCreateTool } from '../src/tools/TaskCreateTool/TaskCreateTool.ts'
import { TaskGetTool } from '../src/tools/TaskGetTool/TaskGetTool.ts'
import { TaskListTool } from '../src/tools/TaskListTool/TaskListTool.ts'
import { TaskUpdateTool } from '../src/tools/TaskUpdateTool/TaskUpdateTool.ts'

test('task tools are available without ToolSearch preloading', () => {
  expect(TaskCreateTool.shouldDefer).toBe(false)
  expect(TaskGetTool.shouldDefer).toBe(false)
  expect(TaskUpdateTool.shouldDefer).toBe(false)
  expect(TaskListTool.shouldDefer).toBe(false)
})

test('TaskCreate accepts dependency fields used by TaskUpdate', () => {
  const parsed = TaskCreateTool.inputSchema.safeParse({
    subject: 'Patch task creation',
    description: 'Make task creation resilient to dependency fields.',
    addBlockedBy: ['1'],
    addBlocks: ['3'],
  })

  expect(parsed.success).toBe(true)
  if (!parsed.success) return
  expect(parsed.data.addBlockedBy).toEqual(['1'])
  expect(parsed.data.addBlocks).toEqual(['3'])
})

test('TaskCreate accepts unambiguous numeric dependency IDs', () => {
  const parsed = TaskCreateTool.inputSchema.safeParse({
    subject: 'Patch task creation',
    description: 'Normalize model-supplied numeric dependency IDs.',
    blockedBy: [1],
    addBlocks: [3],
  })

  expect(parsed.success).toBe(true)
})

test('TaskCreate result nudges complete decomposition without padding atomic work', () => {
  const result = TaskCreateTool.mapToolResultToToolResultBlockParam(
    {
      task: {
        id: '1',
        subject: 'Implement parser',
      },
    },
    'task-create-result',
  )
  expect(result.content).toContain(
    'create the remaining outcome tasks before implementation',
  )
  expect(result.content).toContain(
    'Keep one task only when the work is genuinely atomic',
  )
})

test('TaskUpdate accepts an unambiguous numeric task ID', () => {
  const parsed = TaskUpdateTool.inputSchema.safeParse({
    taskId: 1,
    status: 'in_progress',
    addBlocks: [2],
    addBlockedBy: [3],
  })

  expect(parsed.success).toBe(true)
})

test('TaskGet accepts an unambiguous numeric task ID', () => {
  expect(TaskGetTool.inputSchema.safeParse({ taskId: 1 }).success).toBe(true)
})

test('TaskUpdate rejects ambiguous or lossy numeric task IDs', () => {
  for (const taskId of [
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    expect(
      TaskUpdateTool.inputSchema.safeParse({
        taskId,
        status: 'in_progress',
      }).success,
    ).toBe(false)
  }

  expect(
    TaskUpdateTool.inputSchema.safeParse({
      taskId: true,
      status: 'in_progress',
    }).success,
  ).toBe(false)

  expect(TaskGetTool.inputSchema.safeParse({ taskId: 1.5 }).success).toBe(false)
  expect(
    TaskCreateTool.inputSchema.safeParse({
      subject: 'Reject lossy task ID',
      description: 'Reject it',
      blockedBy: [1.5],
    }).success,
  ).toBe(false)
})
