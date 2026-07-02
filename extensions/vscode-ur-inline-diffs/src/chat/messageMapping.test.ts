import { describe, expect, test } from 'bun:test'
import { extractAssistantContentBlocks, extractToolResultContentBlocks, summarizeToolResultContent } from './messageMapping.js'

describe('extractAssistantContentBlocks', () => {
  test('maps a text block', () => {
    const message = { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello there' }] } }
    expect(extractAssistantContentBlocks(message)).toEqual([{ type: 'text', text: 'Hello there' }])
  })

  test('maps a tool_use block with its input', () => {
    const message = {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'ls' } }] },
    }
    expect(extractAssistantContentBlocks(message)).toEqual([
      { type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'ls' } },
    ])
  })

  test('maps mixed text and tool_use blocks in order', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Let me check.' },
          { type: 'tool_use', id: 'tu-2', name: 'Read', input: { path: 'a.ts' } },
        ],
      },
    }
    expect(extractAssistantContentBlocks(message).map(b => b.type)).toEqual(['text', 'tool_use'])
  })

  test('ignores unknown block types instead of throwing', () => {
    const message = { type: 'assistant', message: { content: [{ type: 'thinking', text: 'internal' }] } }
    expect(extractAssistantContentBlocks(message)).toEqual([])
  })

  test('returns an empty array when content is missing or malformed', () => {
    expect(extractAssistantContentBlocks({ type: 'assistant', message: {} })).toEqual([])
    expect(extractAssistantContentBlocks({})).toEqual([])
    expect(extractAssistantContentBlocks(null)).toEqual([])
    expect(extractAssistantContentBlocks('not an object')).toEqual([])
  })
})

describe('extractToolResultContentBlocks', () => {
  test('maps a successful tool_result', () => {
    const message = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-1', is_error: false, content: 'ok' }] },
    }
    expect(extractToolResultContentBlocks(message)).toEqual([{ type: 'tool_result', toolUseId: 'tu-1', ok: true, summary: 'ok' }])
  })

  test('maps a failed tool_result', () => {
    const message = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-2', is_error: true, content: 'boom' }] },
    }
    const blocks = extractToolResultContentBlocks(message)
    expect(blocks[0]?.type).toBe('tool_result')
    expect(blocks[0]).toMatchObject({ ok: false, toolUseId: 'tu-2' })
  })

  test('returns an empty array for a plain user message with no tool_result blocks', () => {
    const message = { type: 'user', message: { role: 'user', content: 'plain text' } }
    expect(extractToolResultContentBlocks(message)).toEqual([])
  })
})

describe('summarizeToolResultContent', () => {
  test('passes through short strings unchanged', () => {
    expect(summarizeToolResultContent('short')).toBe('short')
  })

  test('extracts text from an Anthropic-shaped content block array', () => {
    expect(summarizeToolResultContent([{ type: 'text', text: 'line one' }])).toBe('line one')
  })

  test('truncates long content with an ellipsis', () => {
    const long = 'x'.repeat(2000)
    const summary = summarizeToolResultContent(long, 50)
    expect(summary.length).toBe(51)
    expect(summary.endsWith('…')).toBe(true)
  })

  test('falls back to JSON.stringify for unrecognized shapes', () => {
    expect(summarizeToolResultContent({ weird: true })).toBe('{"weird":true}')
  })
})
