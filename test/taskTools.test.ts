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
