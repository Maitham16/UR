import { describe, expect, test } from 'bun:test'
import { normalizeContentFromAPI } from '../src/utils/messages.js'

const TOOLS = [
  { name: 'Read' },
  { name: 'Write' },
  { name: 'Bash' },
  { name: 'AskUserQuestion' },
] as never

function normalize(content: unknown): Array<Record<string, unknown>> {
  return normalizeContentFromAPI(
    content as never,
    TOOLS,
  ) as unknown as Array<Record<string, unknown>>
}

/**
 * The repair existed but was wired only into the Ollama provider and the
 * remote transport. The same model reached through OpenRouter or any
 * OpenAI-compatible endpoint had its call dropped and the turn did nothing.
 * Every provider and both stream paths converge here.
 */
describe('a tool call written as text is recovered for every provider', () => {
  test('bare JSON naming a real tool becomes a tool_use block', () => {
    const blocks = normalize([
      {
        type: 'text',
        text: 'I will read the file.\n{"name": "Read", "input": {"file_path": "/tmp/a.ts"}}',
      },
    ])

    const toolUse = blocks.find(block => block.type === 'tool_use')
    expect(toolUse).toBeDefined()
    expect(toolUse!.name).toBe('Read')
    expect(toolUse!.input).toMatchObject({ file_path: '/tmp/a.ts' })
  })

  test('the surrounding prose survives alongside the recovered call', () => {
    const blocks = normalize([
      {
        type: 'text',
        text: 'I will read the file.\n{"name": "Read", "input": {"file_path": "/tmp/a.ts"}}',
      },
    ])

    const text = blocks.find(block => block.type === 'text')
    expect(text).toBeDefined()
    expect(String(text!.text)).toContain('I will read the file.')
  })

  test('a response that already made a real call is left alone', () => {
    const original = [
      { type: 'text', text: 'Reading.\n{"name": "Read", "input": {}}' },
      { type: 'tool_use', id: 'call_1', name: 'Read', input: { file_path: '/x' } },
    ]
    const blocks = normalize(original)

    expect(blocks.filter(block => block.type === 'tool_use')).toHaveLength(1)
    expect(String(blocks[0]!.text)).toContain('{"name": "Read"')
  })

  test('prose naming no known tool is never converted', () => {
    const blocks = normalize([
      {
        type: 'text',
        text: 'The config looks like:\n{"name": "NotATool", "input": {"a": 1}}',
      },
    ])

    expect(blocks.some(block => block.type === 'tool_use')).toBe(false)
  })

  test('ordinary prose is untouched', () => {
    const blocks = normalize([
      { type: 'text', text: 'Here is what I found in the parser.' },
    ])

    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.type).toBe('text')
  })

  test('an empty tool list disables recovery entirely', () => {
    const content = [
      {
        type: 'text',
        text: 'x\n{"name": "Read", "input": {"file_path": "/tmp/a.ts"}}',
      },
    ]
    const blocks = normalizeContentFromAPI(
      content as never,
      [] as never,
    ) as unknown as Array<Record<string, unknown>>

    expect(blocks.some(block => block.type === 'tool_use')).toBe(false)
  })
})
