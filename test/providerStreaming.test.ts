import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import axios from 'axios'
import { createOpenAICompatibleClient } from '../src/services/api/openaiCompatible.js'
import { createOpenRouterClient } from '../src/services/api/openrouter.js'
import { createStandardAPIClient } from '../src/services/api/standardAPI.js'

const sampleTools = [
  {
    name: 'Edit',
    description: 'Modify a file',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['file_path', 'content'],
    },
  },
]

function userMessages() {
  return [{ role: 'user', content: 'hello' }]
}

function sse(chunks: string[]): AsyncIterable<Buffer> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield Buffer.from(chunk)
      }
    },
  }
}

function responseFromChunks(chunks: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  )
}

async function collect(stream: AsyncIterable<any>): Promise<any[]> {
  const events: any[] = []
  for await (const event of stream) {
    events.push(event)
  }
  return events
}

function textDeltas(events: any[]): string[] {
  return events
    .filter(event => event.type === 'content_block_delta')
    .map(event => event.delta)
    .filter(delta => delta?.type === 'text_delta')
    .map(delta => delta.text)
}

describe('provider real streaming', () => {
  afterEach(() => {
    if ((axios.post as any).mockRestore) (axios.post as any).mockRestore()
  })

  test('standard OpenAI streams multiple text deltas from SSE chunks', async () => {
    const post = spyOn(axios, 'post').mockResolvedValue({
      data: sse([
        'data: {"id":"chatcmpl_1","model":"gpt-5.5","choices":[{"delta":{"role":"assistant","content":"Hel"},"index":0}]}\n\n',
        'data: {"id":"chatcmpl_1","model":"gpt-5.5","choices":[{"delta":{"content":"lo"},"index":0}]}\n\n',
        'data: {"id":"chatcmpl_1","model":"gpt-5.5","choices":[{"delta":{},"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":2}}\n\n',
        'data: [DONE]\n\n',
      ]),
      headers: { 'x-request-id': 'req-openai' },
    })
    const client = await createStandardAPIClient({
      providerId: 'openai-api',
      apiKey: 'sk-openai',
      maxRetries: 1,
    })

    const { data } = await client.beta.messages.create({
      model: 'gpt-5.5',
      messages: userMessages(),
      max_tokens: 32,
      stream: true,
    }).withResponse()
    const events = await collect(data)

    const [, body, config] = post.mock.calls[0]
    expect(body.stream).toBe(true)
    expect(config.responseType).toBe('stream')
    expect(textDeltas(events)).toEqual(['Hel', 'lo'])
    expect(events.filter(event => event.type === 'content_block_delta')).toHaveLength(2)
    expect(events.at(-1).type).toBe('message_stop')
  })

  test('OpenAI-compatible streams multiple text deltas from SSE chunks', async () => {
    const original = globalThis.fetch
    const seen: any[] = []
    globalThis.fetch = (async (_url: string, init: any) => {
      seen.push(JSON.parse(init.body))
      return responseFromChunks([
        'data: {"id":"local_1","model":"local-model","choices":[{"delta":{"content":"A"},"index":0}]}\n\n',
        'data: {"id":"local_1","model":"local-model","choices":[{"delta":{"content":"B"},"index":0}]}\n\n',
        'data: {"id":"local_1","model":"local-model","choices":[{"delta":{},"index":0,"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ])
    }) as typeof fetch
    try {
      const client = await createOpenAICompatibleClient({
        baseUrl: 'http://localhost:1234/v1',
        maxRetries: 1,
      })
      const { data } = await client.beta.messages.create({
        model: 'local-model',
        messages: userMessages(),
        max_tokens: 16,
        stream: true,
      }).withResponse()
      const events = await collect(data)

      expect(seen[0].stream).toBe(true)
      expect(textDeltas(events)).toEqual(['A', 'B'])
      expect(events.filter(event => event.type === 'content_block_delta')).toHaveLength(2)
      expect(events.at(-1).type).toBe('message_stop')
    } finally {
      globalThis.fetch = original
    }
  })

  test('OpenAI-compatible streaming rejects malformed tool_call deltas without a function name', async () => {
    const original = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return responseFromChunks([
        'data: {"id":"local_bad_tool","model":"local-model","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_bad","type":"function","function":{"arguments":"{}"}}]},"index":0}]}\n\n',
        'data: {"id":"local_bad_tool","model":"local-model","choices":[{"delta":{},"index":0,"finish_reason":"tool_calls"}]}\n\n',
        'data: [DONE]\n\n',
      ])
    }) as typeof fetch
    try {
      const client = await createOpenAICompatibleClient({
        baseUrl: 'http://localhost:1234/v1',
        maxRetries: 1,
      })
      const { data } = await client.beta.messages.create({
        model: 'local-model',
        messages: userMessages(),
        max_tokens: 16,
        stream: true,
        tools: sampleTools,
      }).withResponse()

      await expect(collect(data)).rejects.toThrow('without a function name')
      expect(calls).toBe(1)
    } finally {
      globalThis.fetch = original
    }
  })

  test('OpenRouter streams OpenAI-format tool_call deltas as tool_use input_json_delta', async () => {
    const post = spyOn(axios, 'post').mockResolvedValue({
      data: sse([
        'data: {"id":"or_1","model":"openai/gpt-5.5","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"Edit","arguments":"{\\"file_path\\""}}]},"index":0}]}\n\n',
        'data: {"id":"or_1","model":"openai/gpt-5.5","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"src/app.ts\\",\\"content\\":\\"updated\\"}"}}]},"index":0}]}\n\n',
        'data: {"id":"or_1","model":"openai/gpt-5.5","choices":[{"delta":{},"index":0,"finish_reason":"tool_calls"}]}\n\n',
        'data: [DONE]\n\n',
      ]),
      headers: { 'x-request-id': 'req-openrouter' },
    })
    const client = await createOpenRouterClient({
      apiKey: 'sk-or',
      maxRetries: 1,
    })

    const { data } = await client.beta.messages.create({
      model: 'openai/gpt-5.5',
      messages: userMessages(),
      max_tokens: 32,
      stream: true,
      tools: sampleTools,
    }).withResponse()
    const events = await collect(data)

    const [, body, config] = post.mock.calls[0]
    expect(body.stream).toBe(true)
    expect(config.responseType).toBe('stream')
    expect(events.find(event => event.type === 'content_block_start')?.content_block)
      .toMatchObject({ type: 'tool_use', id: 'call_1', name: 'Edit' })
    const inputDeltas = events
      .filter(event => event.type === 'content_block_delta')
      .map(event => event.delta)
      .filter(delta => delta?.type === 'input_json_delta')
      .map(delta => delta.partial_json)
    expect(inputDeltas).toEqual([
      '{"file_path"',
      ':"src/app.ts","content":"updated"}',
    ])
    expect(events.find(event => event.type === 'message_delta')?.delta.stop_reason)
      .toBe('tool_use')
    expect(events.at(-1).type).toBe('message_stop')
  })

  test('standard Anthropic passes through streaming text and tool_use events', async () => {
    const post = spyOn(axios, 'post').mockResolvedValue({
      data: sse([
        'data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-sonnet-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}\n\n',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" there"}}\n\n',
        'data: {"type":"content_block_stop","index":0}\n\n',
        'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"Edit","input":{}}}\n\n',
        'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"file_path\\":\\"src/app.ts\\"}"}}\n\n',
        'data: {"type":"content_block_stop","index":1}\n\n',
        'data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":4}}\n\n',
        'data: {"type":"message_stop"}\n\n',
      ]),
      headers: { 'x-request-id': 'req-anthropic' },
    })
    const client = await createStandardAPIClient({
      providerId: 'anthropic-api',
      apiKey: 'sk-ant',
      maxRetries: 1,
    })

    const { data } = await client.beta.messages.create({
      model: 'claude-sonnet-5',
      messages: userMessages(),
      max_tokens: 32,
      stream: true,
      tools: sampleTools,
    }).withResponse()
    const events = await collect(data)

    const [, body, config] = post.mock.calls[0]
    expect(body.stream).toBe(true)
    expect(config.responseType).toBe('stream')
    expect(textDeltas(events)).toEqual(['Hi', ' there'])
    expect(events.find(event => event.type === 'content_block_start' && event.index === 1)?.content_block)
      .toMatchObject({ type: 'tool_use', id: 'toolu_1', name: 'Edit' })
    expect(events.find(event => event.type === 'message_delta')?.delta.stop_reason)
      .toBe('tool_use')
  })

  test('standard Gemini streams text deltas and functionCall parts', async () => {
    const post = spyOn(axios, 'post').mockResolvedValue({
      data: sse([
        'data: {"candidates":[{"content":{"parts":[{"text":"Ge"}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"mini"}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"Edit","args":{"file_path":"src/app.ts","content":"updated"}}}]},"finishReason":"FUNCTION_CALL"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":2}}\n\n',
      ]),
      headers: { 'x-request-id': 'req-gemini' },
    })
    const client = await createStandardAPIClient({
      providerId: 'gemini-api',
      apiKey: 'gm-key',
      maxRetries: 1,
    })

    const { data } = await client.beta.messages.create({
      model: 'gemini-3.5-flash',
      messages: userMessages(),
      max_tokens: 32,
      stream: true,
      tools: sampleTools,
    }).withResponse()
    const events = await collect(data)

    const [url, body, config] = post.mock.calls[0]
    expect(url).toContain(':streamGenerateContent?alt=sse')
    expect(body).not.toHaveProperty('stream')
    expect(config.responseType).toBe('stream')
    expect(textDeltas(events)).toEqual(['Ge', 'mini'])
    expect(events.find(event => event.type === 'content_block_start' && event.content_block?.type === 'tool_use')?.content_block)
      .toMatchObject({ type: 'tool_use', name: 'Edit' })
    expect(events.find(event => event.type === 'message_delta')?.delta.stop_reason)
      .toBe('tool_use')
    expect(events.at(-1).type).toBe('message_stop')
  })
})
