import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import axios from 'axios'
import { createStandardAPIClient } from '../src/services/api/standardAPI.js'

type StopReasonCase = {
  family: 'anthropic' | 'openai' | 'google'
  providerId: string
  reason: string
  expected: string
  tool?: boolean
}

const cases: StopReasonCase[] = [
  { family: 'anthropic', providerId: 'anthropic-api', reason: 'max_tokens', expected: 'max_tokens' },
  { family: 'anthropic', providerId: 'anthropic-api', reason: 'model_context_window_exceeded', expected: 'model_context_window_exceeded' },
  { family: 'anthropic', providerId: 'anthropic-api', reason: 'end_turn', expected: 'end_turn' },
  { family: 'anthropic', providerId: 'anthropic-api', reason: 'tool_use', expected: 'tool_use', tool: true },
  { family: 'openai', providerId: 'openai-api', reason: 'length', expected: 'max_tokens' },
  { family: 'openai', providerId: 'openai-api', reason: 'stop', expected: 'end_turn' },
  { family: 'openai', providerId: 'openai-api', reason: 'tool_calls', expected: 'tool_use', tool: true },
  { family: 'google', providerId: 'gemini-api', reason: 'MAX_TOKENS', expected: 'max_tokens' },
  { family: 'google', providerId: 'gemini-api', reason: 'STOP', expected: 'end_turn' },
  { family: 'google', providerId: 'gemini-api', reason: 'FUNCTION_CALL', expected: 'tool_use', tool: true },
]

const text = 'Partial answer preserved at the provider boundary.'
const tool = { type: 'tool_use', id: 'call-stop-reason', name: 'Read', input: { file_path: 'README.md' } }

function wireResponse(entry: StopReasonCase) {
  if (entry.family === 'anthropic') {
    return {
      id: 'stop-reason-fixture', model: 'fixture-model',
      content: entry.tool ? [tool] : [{ type: 'text', text }],
      stop_reason: entry.reason,
      usage: { input_tokens: 3, output_tokens: 4 },
    }
  }
  if (entry.family === 'openai') {
    return {
      id: 'stop-reason-fixture', model: 'fixture-model',
      choices: [{ message: entry.tool ? {
        role: 'assistant', content: null,
        tool_calls: [{ id: tool.id, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.input) } }],
      } : { role: 'assistant', content: text }, finish_reason: entry.reason }],
      usage: { prompt_tokens: 3, completion_tokens: 4 },
    }
  }
  return {
    candidates: [{ content: { parts: entry.tool
      ? [{ functionCall: { id: tool.id, name: tool.name, args: tool.input } }]
      : [{ text }],
    }, finishReason: entry.reason }],
    usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 },
  }
}

function wireStream(entry: StopReasonCase): AsyncIterable<Buffer> {
  let events: unknown[]
  if (entry.family === 'anthropic') {
    events = [
      { type: 'message_start', message: { id: 'stop-reason-fixture', model: 'fixture-model', usage: { input_tokens: 3, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: entry.tool ? tool : { type: 'text', text: '' } },
      ...(!entry.tool ? [{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }] : []),
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: entry.reason, stop_sequence: null }, usage: { output_tokens: 4 } },
      { type: 'message_stop' },
    ]
  } else if (entry.family === 'openai') {
    events = [
      { id: 'stop-reason-fixture', model: 'fixture-model', choices: [{ index: 0, delta: entry.tool ? {
        tool_calls: [{ index: 0, id: tool.id, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.input) } }],
      } : { content: text } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: entry.reason }], usage: { prompt_tokens: 3, completion_tokens: 4 } },
    ]
  } else events = [wireResponse(entry)]
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield Buffer.from(`data: ${JSON.stringify(event)}\n\n`)
      if (entry.family === 'openai') yield Buffer.from('data: [DONE]\n\n')
    },
  }
}

describe('standard provider stop-reason parity', () => {
  afterEach(() => {
    if ((axios.post as any).mockRestore) (axios.post as any).mockRestore()
  })

  for (const entry of cases) {
    test(`${entry.family} preserves ${entry.reason} across buffered and streamed responses`, async () => {
      const post = spyOn(axios, 'post')
        .mockResolvedValueOnce({ data: wireResponse(entry), headers: {} })
        .mockResolvedValueOnce({ data: wireStream(entry), headers: {} })
      const client = await createStandardAPIClient({
        providerId: entry.providerId, apiKey: 'fixture-no-secret', maxRetries: 0,
      })
      const params = {
        model: 'fixture-model', messages: [{ role: 'user', content: 'Continue the task.' }], max_tokens: 4096,
      }
      const buffered = await client.beta.messages.create(params)
      const { data } = await client.beta.messages.create({ ...params, stream: true }).withResponse()
      const streamed: any[] = []
      for await (const event of data) streamed.push(event)

      expect(buffered.stop_reason).toBe(entry.expected)
      expect(streamed.find(event => event.type === 'message_delta')?.delta.stop_reason).toBe(entry.expected)
      expect(buffered.usage.output_tokens).toBe(4)
      expect(streamed.find(event => event.type === 'message_delta')?.usage.output_tokens).toBe(4)
      if (entry.tool) {
        expect(buffered.content).toContainEqual(expect.objectContaining(tool))
        expect(streamed.find(event => event.type === 'content_block_start')?.content_block).toMatchObject({ type: 'tool_use', name: tool.name })
      } else {
        expect(buffered.content).toContainEqual({ type: 'text', text })
        expect(streamed.filter(event => event.type === 'content_block_delta').map(event => event.delta?.text ?? '').join('')).toBe(text)
      }
      expect(post).toHaveBeenCalledTimes(2)
    })
  }
})
