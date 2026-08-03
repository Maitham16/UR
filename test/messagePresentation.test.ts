import { describe, expect, test } from 'bun:test'
import {
  dropIntermediateToolNarration,
  shouldShowLiveAssistantDraft,
} from '../src/utils/messagePresentation.js'

type FixtureMessage = {
  type: string
  uuid: string
  isApiErrorMessage?: boolean
  message: {
    id?: string
    content: Array<{ type: string; text?: string; name?: string }>
  }
}

function assistant(
  id: string,
  index: number,
  block: { type: string; text?: string; name?: string },
): FixtureMessage {
  return {
    type: 'assistant',
    uuid: `aaaaaaaa-aaaa-aaaa-aaaa-${String(index).padStart(12, '0')}`,
    message: { id, content: [block] },
  }
}

describe('compact normal-screen assistant presentation', () => {
  test('drops narration paired with a tool call but preserves the final answer', () => {
    const prelude = assistant('response-1', 0, {
      type: 'text',
      text: "I'll inspect the codebase first.",
    })
    const tool = assistant('response-1', 1, {
      type: 'tool_use',
      name: 'Read',
    })
    const final = assistant('response-2', 2, {
      type: 'text',
      text: 'The implementation is complete.',
    })

    expect(dropIntermediateToolNarration([prelude, tool, final])).toEqual([
      tool,
      final,
    ])
  })

  test('recognizes provider-native tool-use block variants', () => {
    const prelude = assistant('response-1', 0, {
      type: 'text',
      text: 'Let me search.',
    })
    const tool = assistant('response-1', 1, { type: 'server_tool_use' })

    expect(dropIntermediateToolNarration([prelude, tool])).toEqual([tool])
  })

  test('fails open for an unnormalized multi-block response', () => {
    const unsplit: FixtureMessage = {
      type: 'assistant',
      uuid: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000000',
      message: {
        id: 'response-1',
        content: [
          { type: 'text', text: 'Let me inspect.' },
          { type: 'tool_use', name: 'Read' },
        ],
      },
    }

    expect(dropIntermediateToolNarration([unsplit])).toEqual([unsplit])
  })

  test('preserves API errors even when they share a tool response', () => {
    const error = {
      ...assistant('response-1', 0, {
        type: 'text',
        text: 'The provider rejected the request.',
      }),
      isApiErrorMessage: true,
    }
    const tool = assistant('response-1', 1, { type: 'tool_use', name: 'Read' })

    expect(dropIntermediateToolNarration([error, tool])).toEqual([error, tool])
  })

  test('falls back to the derived UUID source when provider IDs are absent', () => {
    const prelude = assistant('', 0, {
      type: 'text',
      text: 'I will inspect the file.',
    })
    const tool = assistant('', 1, { type: 'tool_use', name: 'Read' })
    delete prelude.message.id
    delete tool.message.id

    expect(dropIntermediateToolNarration([prelude, tool])).toEqual([tool])
  })

  test('live draft text is opt-in through transcript or verbose diagnostics', () => {
    expect(shouldShowLiveAssistantDraft(false, false)).toBe(false)
    expect(shouldShowLiveAssistantDraft(true, false)).toBe(true)
    expect(shouldShowLiveAssistantDraft(false, true)).toBe(true)
  })
})
