import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  OpenAIResponsesHTTPTransport,
  buildDeferredToolSearchTools,
  createClientToolSearchOutput,
  createOpenAIResponsesClient,
  createOpenAIResponsesWebSocketSession,
  parseOpenAIResponsesMessage,
  toOpenAIResponsesRequest,
  type OpenAIResponsesWebSocketLike,
} from '../src/services/api/openaiResponses.js'
import { OpenAIResponsesStateStore } from '../src/services/api/openaiResponsesState.js'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'ur-openai-responses-'))
  temporaryDirectories.push(path)
  return path
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true })
  }
})

const tools = [
  {
    name: 'Edit',
    description: 'Modify a file',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    strict: true,
  },
]

function rawResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'resp_test_1',
    object: 'response',
    status: 'completed',
    model: 'gpt-test',
    output: [
      {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'done', annotations: [] }],
      },
    ],
    usage: {
      input_tokens: 4,
      output_tokens: 2,
      input_tokens_details: { cached_tokens: 1, cache_write_tokens: 2 },
    },
    ...overrides,
  }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req_test' },
  })
}

function sseResponse(events: any[]): Response {
  const body = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req_stream' },
  })
}

async function collect(stream: AsyncIterable<any>): Promise<any[]> {
  const events: any[] = []
  for await (const event of stream) events.push(event)
  return events
}

describe('OpenAI Responses request and response mapping', () => {
  test('maps multimodal history, tool calls, structured output, compaction, and privacy defaults', () => {
    const body = toOpenAIResponsesRequest(
      {
        model: 'gpt-test',
        system: [{ type: 'text', text: 'Be precise.' }],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Inspect this' },
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' },
              },
            ],
          },
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'call_1', name: 'Edit', input: { path: 'a.ts' } }],
          },
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'ok' }],
          },
        ],
        max_tokens: 500,
        tools,
        tool_choice: { type: 'tool', name: 'Edit' },
        output_config: {
          effort: 'high',
          format: {
            type: 'json_schema',
            name: 'answer',
            schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
          },
        },
      },
      { compactThreshold: 20_000 },
    ) as any

    expect(body.store).toBe(false)
    expect(body.instructions).toBe('Be precise.')
    expect(body.max_output_tokens).toBe(500)
    expect(body.input[0].content[1]).toEqual({
      type: 'input_image',
      detail: 'auto',
      image_url: 'data:image/png;base64,aGVsbG8=',
    })
    expect(body.input[1]).toMatchObject({
      type: 'function_call',
      call_id: 'call_1',
      arguments: '{"path":"a.ts"}',
    })
    expect(body.input[2]).toEqual({
      type: 'function_call_output',
      call_id: 'call_1',
      output: 'ok',
      status: 'completed',
    })
    expect(body.tools[0]).toMatchObject({
      type: 'function',
      name: 'Edit',
      strict: true,
    })
    expect(body.tool_choice).toEqual({ type: 'function', name: 'Edit' })
    expect(body.text.format).toMatchObject({ type: 'json_schema', name: 'answer', strict: true })
    expect(body.text.verbosity).toBe('high')
    expect(body.context_management).toEqual([
      { type: 'compaction', compact_threshold: 20_000 },
    ])
  })

  test('parses text, function calls, cache usage, and preserves opaque provider items', () => {
    const opaque = { id: 'cmp_1', type: 'compaction', encrypted_content: 'opaque' }
    const message = parseOpenAIResponsesMessage(
      rawResponse({
        output: [
          opaque,
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'working' }],
          },
          {
            type: 'function_call',
            call_id: 'call_2',
            name: 'Edit',
            namespace: 'ur',
            arguments: '{"path":"b.ts"}',
          },
        ],
      }),
      'fallback',
    )
    expect(message.stop_reason).toBe('tool_use')
    expect(message.content).toEqual([
      { type: 'text', text: 'working' },
      {
        type: 'tool_use',
        id: 'call_2',
        name: 'Edit',
        namespace: 'ur',
        input: { path: 'b.ts' },
      },
    ])
    expect(message.usage).toEqual({
      input_tokens: 4,
      output_tokens: 2,
      cache_creation_input_tokens: 2,
      cache_read_input_tokens: 1,
    })
    expect(message.openai_response_output[0]).toEqual(opaque)
  })

  test('adapts non-streaming and streaming message calls without network access', async () => {
    const requests: Array<{ url: string; body: any; headers: Headers }> = []
    let call = 0
    const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)),
        headers: new Headers(init?.headers),
      })
      call++
      if (call === 1) return jsonResponse(rawResponse())
      return sseResponse([
        {
          type: 'response.created',
          sequence_number: 0,
          response: rawResponse({ status: 'in_progress', output: [], usage: undefined }),
        },
        {
          type: 'response.output_text.delta',
          sequence_number: 1,
          output_index: 0,
          content_index: 0,
          delta: 'hel',
        },
        {
          type: 'response.output_text.delta',
          sequence_number: 2,
          output_index: 0,
          content_index: 0,
          delta: 'lo',
        },
        {
          type: 'response.completed',
          sequence_number: 3,
          response: rawResponse(),
        },
      ])
    }
    const client = await createOpenAIResponsesClient({
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1',
      maxRetries: 0,
      fetch,
    })
    const result = await client.beta.messages.create({
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'go' }],
      max_tokens: 10,
    }) as any
    expect(result.content).toEqual([{ type: 'text', text: 'done' }])
    expect(requests[0].url).toBe('https://example.test/v1/responses')
    expect(requests[0].headers.get('authorization')).toBe('Bearer test-key')
    expect(requests[0].headers.get('idempotency-key')).toBeTruthy()

    const handle = client.beta.messages.create({
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'stream' }],
      max_tokens: 10,
      stream: true,
    }) as any
    const streamed = await handle.withResponse()
    const events = await collect(streamed.data)
    expect(events
      .filter(event => event.delta?.type === 'text_delta')
      .map(event => event.delta.text)).toEqual(['hel', 'lo'])
    expect(events.at(-1)?.type).toBe('message_stop')
    expect(requests[1].body.stream).toBe(true)
    expect(requests[1].body.background).toBe(false)
  })
})

describe('OpenAI Responses durable workflows', () => {
  test('creates, polls, cancels, resumes, and checkpoints background responses', async () => {
    const cwd = temporaryDirectory()
    const store = new OpenAIResponsesStateStore({ cwd })
    const calls: Array<{ url: string; method: string; body?: any }> = []
    const retrieveStatuses = ['queued', 'in_progress', 'completed']
    const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ url, method, body })
      if (url.includes('stream=true')) {
        return sseResponse([
          {
            type: 'response.created',
            sequence_number: 5,
            response: rawResponse({ status: 'in_progress', output: [] }),
          },
          {
            type: 'response.output_text.delta',
            sequence_number: 6,
            output_index: 0,
            content_index: 0,
            delta: 'resumed',
          },
          {
            type: 'response.completed',
            sequence_number: 7,
            response: rawResponse(),
          },
        ])
      }
      if (url.endsWith('/cancel')) {
        return jsonResponse(rawResponse({ status: 'cancelled' }))
      }
      if (method === 'GET') {
        return jsonResponse(rawResponse({ status: retrieveStatuses.shift() ?? 'completed' }))
      }
      return jsonResponse(rawResponse({ status: 'queued', output: [] }))
    }
    const transport = new OpenAIResponsesHTTPTransport({
      apiKey: 'test-key',
      fetch,
      maxRetries: 0,
      stateStore: store,
    })
    const created = await transport.createBackground({
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'long job' }],
    })
    expect(created.status).toBe('queued')
    expect(calls[0].body).toMatchObject({ background: true, stream: false, store: false })
    expect(store.get('resp_test_1')).toMatchObject({
      status: 'queued',
      mode: 'background',
    })

    const completed = await transport.poll('resp_test_1', { intervalMs: 0, maxWaitMs: 1_000 })
    expect(completed.status).toBe('completed')
    const resumed = await transport.resumeStream('resp_test_1', { startingAfter: 4 })
    const events = await collect(resumed.data)
    expect(events.some(event => event.delta?.text === 'resumed')).toBe(true)
    expect(calls.some(call => call.url.includes('starting_after=4'))).toBe(true)
    expect(store.get('resp_test_1')?.cursor).toBe(7)

    const cancelled = await transport.cancel('resp_test_1')
    expect(cancelled.status).toBe('cancelled')
    expect(calls.at(-1)?.url).toEndWith('/responses/resp_test_1/cancel')
  })

  test('persists only metadata by default and encrypts canonical compaction output', async () => {
    const cwd = temporaryDirectory()
    const key = Buffer.alloc(32, 9).toString('base64')
    const store = new OpenAIResponsesStateStore({ cwd, encryptionKey: key })
    store.upsert({
      id: 'resp_private',
      status: 'completed',
      model: 'gpt-test',
      mode: 'background',
    })
    const compactedOutput = [
      { type: 'message', role: 'user', content: 'secret prompt' },
      { id: 'cmp_private', type: 'compaction', encrypted_content: 'provider-opaque' },
    ]
    const transport = new OpenAIResponsesHTTPTransport({
      apiKey: 'test-key',
      maxRetries: 0,
      stateStore: store,
      fetch: async () => jsonResponse({
        id: 'cmp_result',
        object: 'response.compaction',
        output: compactedOutput,
        usage: { input_tokens: 2, output_tokens: 1 },
      }),
    })
    const compacted = await transport.compact(
      { model: 'gpt-test', input: [{ role: 'user', content: 'secret prompt' }] },
      { persistForResponseId: 'resp_private' },
    )
    expect(compacted.output).toEqual(compactedOutput)
    const manifest = readFileSync(store.path, 'utf8')
    expect(manifest).not.toContain('secret prompt')
    expect(manifest).not.toContain('provider-opaque')
    expect(store.getCompactedWindow('resp_private')).toEqual(compactedOutput)
    expect(statSync(store.path).mode & 0o777).toBe(0o600)
  })

  test('refuses plaintext context and fails closed on corrupt state', () => {
    const cwd = temporaryDirectory()
    const store = new OpenAIResponsesStateStore({ cwd })
    store.upsert({
      id: 'resp_safe',
      status: 'completed',
      model: 'gpt-test',
      mode: 'http',
    })
    expect(() => store.setCompactedWindow('resp_safe', ['plaintext'])).toThrow(
      'Refusing to persist compacted context',
    )
    writeFileSync(store.path, '{broken', 'utf8')
    expect(() => store.list()).toThrow('not valid JSON')
  })
})

describe('OpenAI Responses deferred tools and WebSocket mode', () => {
  test('chunks hosted namespaces and returns bounded client search results', () => {
    const manyTools = Array.from({ length: 23 }, (_, index) => ({
      name: `tool_${index}`,
      description: index === 12 ? 'Special deployment helper' : 'General helper',
      input_schema: { type: 'object', properties: {} },
    }))
    const deferred = buildDeferredToolSearchTools(manyTools)
    const namespaces = deferred.filter(tool => tool.type === 'namespace')
    expect(namespaces.map(namespace => namespace.tools.length)).toEqual([10, 10, 3])
    expect(namespaces.every(namespace =>
      namespace.tools.every((tool: any) => tool.defer_loading === true))).toBe(true)
    expect(deferred.at(-1)).toEqual({ type: 'tool_search' })

    const output = createClientToolSearchOutput(
      { call_id: 'search_1', arguments: { query: 'deployment' } },
      manyTools,
    ) as any
    expect(output.type).toBe('tool_search_output')
    expect(output.tools).toHaveLength(1)
    expect(output.tools[0].name).toBe('tool_12')
  })

  test('serializes WebSocket responses, chains ids, strips forbidden flags, and recovers explicitly', async () => {
    class FakeSocket implements OpenAIResponsesWebSocketLike {
      readyState = 1
      sent: any[] = []
      listeners = new Map<string, Set<(event: any) => void>>()
      rejectPreviousOnce = false

      addEventListener(type: string, listener: (event: any) => void) {
        const set = this.listeners.get(type) ?? new Set()
        set.add(listener)
        this.listeners.set(type, set)
      }

      removeEventListener(type: string, listener: (event: any) => void) {
        this.listeners.get(type)?.delete(listener)
      }

      dispatch(type: string, event: any) {
        for (const listener of this.listeners.get(type) ?? []) listener(event)
      }

      send(data: string) {
        const request = JSON.parse(data)
        this.sent.push(request)
        queueMicrotask(() => {
          if (this.rejectPreviousOnce && request.previous_response_id) {
            this.rejectPreviousOnce = false
            this.dispatch('message', {
              data: JSON.stringify({
                type: 'error',
                error: { code: 'previous_response_not_found', message: 'expired' },
              }),
            })
            return
          }
          const id = `resp_ws_${this.sent.length}`
          this.dispatch('message', {
            data: JSON.stringify({
              type: 'response.completed',
              response: rawResponse({ id }),
            }),
          })
        })
      }

      close() {}
    }

    const socket = new FakeSocket()
    let headers: Record<string, string> | undefined
    const session = await createOpenAIResponsesWebSocketSession({
      apiKey: 'test-key',
      model: 'gpt-test',
      factory: async (_url, receivedHeaders) => {
        headers = receivedHeaders
        return socket
      },
    })
    const [first, second] = await Promise.all([
      session.create({ input: 'one', stream: true, background: true }),
      session.create({ input: 'two' }),
    ])
    expect(first.id).toBe('resp_ws_1')
    expect(second.id).toBe('resp_ws_2')
    expect(headers?.Authorization).toBe('Bearer test-key')
    expect(socket.sent[0]).toMatchObject({
      type: 'response.create',
      model: 'gpt-test',
      input: 'one',
      store: false,
    })
    expect(socket.sent[0].stream).toBeUndefined()
    expect(socket.sent[0].background).toBeUndefined()
    expect(socket.sent[1].previous_response_id).toBe('resp_ws_1')

    socket.rejectPreviousOnce = true
    const recovered = await session.create(
      { input: 'incremental' },
      { recoveryInput: [{ role: 'user', content: 'full context' }] },
    )
    expect(recovered.id).toBe('resp_ws_4')
    expect(socket.sent[2].previous_response_id).toBe('resp_ws_2')
    expect(socket.sent[3].previous_response_id).toBeUndefined()
    expect(socket.sent[3].input).toEqual([{ role: 'user', content: 'full context' }])
  })
})
