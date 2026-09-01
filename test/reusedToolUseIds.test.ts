import { expect, test } from 'bun:test'
import {
  canonicalizeReusedToolUseIds,
  createAssistantMessage,
  createUserMessage,
  ensureToolResultPairing,
} from '../src/utils/messages.js'

function toolCall(id: string, subject: string) {
  return createAssistantMessage({
    content: [
      {
        type: 'tool_use',
        id,
        name: 'TaskCreate',
        input: { subject },
      },
    ] as any,
  })
}

function toolResult(id: string, content: string) {
  return createUserMessage({
    content: [
      {
        type: 'tool_result',
        tool_use_id: id,
        content,
      },
    ],
  })
}

test('completed calls with response-scoped reused IDs keep both results', () => {
  const messages = [
    toolCall('TaskCreate:0', 'First task'),
    toolResult('TaskCreate:0', 'Task #1 created'),
    toolCall('TaskCreate:0', 'Second task'),
    toolResult('TaskCreate:0', 'Task #2 created'),
  ]

  const normalized = canonicalizeReusedToolUseIds(messages)
  const firstId = (normalized[0]!.message.content[0] as any).id
  const secondId = (normalized[2]!.message.content[0] as any).id

  expect(firstId).toBe('TaskCreate:0')
  expect(secondId).not.toBe(firstId)
  expect((normalized[1]!.message.content[0] as any).tool_use_id).toBe(firstId)
  expect((normalized[3]!.message.content[0] as any).tool_use_id).toBe(secondId)

  const paired = ensureToolResultPairing(normalized)
  expect(paired).toHaveLength(4)
  expect((paired[2]!.message.content[0] as any).type).toBe('tool_use')
  expect((paired[3]!.message.content[0] as any).content).toBe('Task #2 created')
})

test('same-message duplicate IDs remain visible to corruption repair', () => {
  const assistant = createAssistantMessage({
    content: [
      { type: 'tool_use', id: 'same', name: 'TaskCreate', input: { subject: 'A' } },
      { type: 'tool_use', id: 'same', name: 'TaskCreate', input: { subject: 'B' } },
    ] as any,
  })
  const result = createUserMessage({
    content: [
      { type: 'tool_result', tool_use_id: 'same', content: 'A' },
      { type: 'tool_result', tool_use_id: 'same', content: 'B' },
    ],
  })

  const normalized = canonicalizeReusedToolUseIds([assistant, result])
  expect(normalized).toEqual([assistant, result])

  const repaired = ensureToolResultPairing(normalized)
  expect(
    repaired[0]!.message.content.filter((block: any) => block.type === 'tool_use'),
  ).toHaveLength(1)
  expect(
    repaired[1]!.message.content.filter((block: any) => block.type === 'tool_result'),
  ).toHaveLength(1)
})

test('unmatched reused IDs remain available for missing-result repair', () => {
  const messages = [
    toolCall('call_0', 'First task'),
    toolResult('call_0', 'Task #1 created'),
    toolCall('call_0', 'Interrupted second task'),
  ]

  const normalized = canonicalizeReusedToolUseIds(messages)
  expect((normalized[2]!.message.content[0] as any).id).toBe('call_0')

  const repaired = ensureToolResultPairing(normalized)
  expect((repaired[2]!.message.content[0] as any).text).toBe(
    '[Tool use interrupted]',
  )
})
