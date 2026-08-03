import { describe, expect, test } from 'bun:test'
import { TaskGetTool } from '../src/tools/TaskGetTool/TaskGetTool.js'

function resultText(data: unknown): string {
  const block = TaskGetTool.mapToolResultToToolResultBlockParam!(
    data as never,
    'test-tool-use',
  )
  const content = (block as { content: unknown }).content
  return typeof content === 'string' ? content : JSON.stringify(content)
}

/**
 * A bare "Task not found" said nothing about whether the id was wrong, the
 * list had been archived into a new generation, or the task was deleted — so
 * the usual response was to retry the same id.
 */
describe('a missing task names what exists', () => {
  test('the existing ids are listed', () => {
    const text = resultText({ task: null, availableTaskIds: ['1', '2', '7'] })

    expect(text).toContain('Task not found')
    expect(text).toContain('#1, #2, #7')
  })

  test('an empty list says so and points at creating the task', () => {
    const text = resultText({ task: null, availableTaskIds: [] })

    expect(text).toContain('task list is empty')
    expect(text).toContain('create the task')
  })

  test('a missing field degrades to the empty-list wording rather than throwing', () => {
    expect(() => resultText({ task: null })).not.toThrow()
    expect(resultText({ task: null })).toContain('Task not found')
  })

  test('a found task is unaffected', () => {
    const text = resultText({
      task: {
        id: '3',
        subject: 'Fix the parser',
        description: 'Repair the tokenizer',
        status: 'pending',
        blocks: [],
        blockedBy: [],
      },
    })

    expect(text).toContain('Task #3')
    expect(text).not.toContain('not found')
  })
})
