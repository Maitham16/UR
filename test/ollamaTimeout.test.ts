import { expect, test } from 'bun:test'
import {
  createOllamaURHQClient,
  getOllamaRequestTimeoutMs,
} from '../src/services/api/ollama.js'

test('getOllamaRequestTimeoutMs defaults to five minutes for local Ollama', () => {
  expect(getOllamaRequestTimeoutMs(undefined, {})).toBe(300_000)
})

test('getOllamaRequestTimeoutMs respects API_TIMEOUT_MS', () => {
  expect(getOllamaRequestTimeoutMs(undefined, { API_TIMEOUT_MS: '45000' })).toBe(
    45_000,
  )
})

test('getOllamaRequestTimeoutMs lets explicit request timeout win', () => {
  expect(
    getOllamaRequestTimeoutMs(
      { timeout: 12_345 },
      { API_TIMEOUT_MS: '45000' },
    ),
  ).toBe(12_345)
})

test('getOllamaRequestTimeoutMs uses shorter default for remote sessions', () => {
  expect(getOllamaRequestTimeoutMs(undefined, { UR_CODE_REMOTE: '1' })).toBe(
    120_000,
  )
})

test('Ollama chat requests enable thinking when the model advertises it', async () => {
  const previousFetch = globalThis.fetch
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = createMockOllamaFetch({
    capabilities: ['completion', 'tools', 'thinking', 'vision'],
    onChatRequest(body) {
      requestBody = body
    },
  })

  try {
    const { data } = await createStreamingOllamaResponse({
      model: 'thinking-model:latest',
      thinking: { type: 'enabled', budget_tokens: 1024 },
    })
    for await (const _event of data) {
      // consume the stream so body parsing runs
    }
    expect(requestBody?.think).toBe(true)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('Ollama chat requests omit think when the model does not advertise thinking', async () => {
  const previousFetch = globalThis.fetch
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = createMockOllamaFetch({
    capabilities: ['completion', 'tools'],
    onChatRequest(body) {
      requestBody = body
    },
  })

  try {
    const { data } = await createStreamingOllamaResponse({
      model: 'plain-model:latest',
      thinking: { type: 'enabled', budget_tokens: 1024 },
    })
    for await (const _event of data) {
      // consume the stream so body parsing runs
    }
    expect('think' in (requestBody ?? {})).toBe(false)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('Ollama chat requests set num_ctx and keep_alive for warm, full-context runs', async () => {
  const previousFetch = globalThis.fetch
  let requestBody: Record<string, any> | undefined

  globalThis.fetch = createMockOllamaFetch({
    capabilities: ['completion', 'tools'],
    onChatRequest(body) {
      requestBody = body
    },
  })

  try {
    const { data } = await createStreamingOllamaResponse({
      model: 'tuning-model:latest',
    })
    for await (const _event of data) {
      // consume the stream so body parsing runs
    }
    expect(requestBody?.keep_alive).toBe('30m')
    expect(requestBody?.options?.num_ctx).toBe(32768)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('Ollama chat requests keep vision inputs for vision-capable models', async () => {
  const previousFetch = globalThis.fetch
  let requestBody: Record<string, any> | undefined

  globalThis.fetch = createMockOllamaFetch({
    capabilities: ['completion', 'vision'],
    onChatRequest(body) {
      requestBody = body
    },
  })

  try {
    const { data } = await createStreamingOllamaResponse({
      model: 'vision-model:latest',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'describe this' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'base64-image',
              },
            },
          ],
        },
      ],
    })
    for await (const _event of data) {
      // consume the stream so body parsing runs
    }
    expect(requestBody?.messages?.[0]?.images).toEqual(['base64-image'])
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('Ollama chat requests omit native tools when the model does not advertise tools', async () => {
  const previousFetch = globalThis.fetch
  let requestBody: Record<string, unknown> | undefined

  globalThis.fetch = createMockOllamaFetch({
    capabilities: ['completion', 'thinking'],
    onChatRequest(body) {
      requestBody = body
    },
  })

  try {
    const { data } = await createStreamingOllamaResponse({
      model: 'no-tools-model:latest',
      tools: [
        {
          name: 'example_tool',
          description: 'Example tool',
          input_schema: { type: 'object', properties: {} },
        },
      ],
    })
    for await (const _event of data) {
      // consume the stream so body parsing runs
    }
    expect('tools' in (requestBody ?? {})).toBe(false)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('Ollama stream forwards unexpected thinking chunks before text', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = createMockOllamaFetch({
    capabilities: ['completion', 'tools', 'thinking', 'vision'],
    chunks: [
      {
        message: { role: 'assistant', content: '', thinking: 'thinking' },
        done: false,
      },
      {
        message: { role: 'assistant', content: 'ok' },
        done: false,
      },
      {
        message: { role: 'assistant', content: '' },
        done: true,
        done_reason: 'stop',
      },
    ],
  })

  try {
    const { data } = await createStreamingOllamaResponse({
      model: 'stream-thinking-model:latest',
      thinking: { type: 'enabled', budget_tokens: 1024 },
    })
    const events: any[] = []
    for await (const event of data) {
      events.push(event)
    }

    expect(
      events.some(
        event =>
          event.type === 'content_block_start' &&
          event.content_block?.type === 'thinking',
      ),
    ).toBe(true)
    expect(
      events.some(
        event =>
          event.type === 'content_block_delta' &&
          event.delta?.type === 'thinking_delta' &&
          event.delta?.thinking === 'thinking',
      ),
    ).toBe(true)
    expect(
      events.some(
        event =>
          event.type === 'content_block_delta' &&
          event.delta?.type === 'text_delta' &&
          event.delta?.text === 'ok',
      ),
    ).toBe(true)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('Ollama stream timeout applies after response headers', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = createMockOllamaFetch({
    capabilities: ['completion', 'thinking'],
    chatResponse: new Response(
      new ReadableStream({
        start() {
          // Keep the response body open without producing chunks.
        },
      }),
      { status: 200 },
    ),
  })

  try {
    const { data } = await createStreamingOllamaResponse({
      model: 'stalling-model:latest',
      requestOptions: { timeout: 10 },
      thinking: { type: 'enabled', budget_tokens: 1024 },
    })
    const iterator = data[Symbol.asyncIterator]()
    expect((await iterator.next()).value.type).toBe('message_start')
    await expect(iterator.next()).rejects.toThrow('Ollama stream timed out')
  } finally {
    globalThis.fetch = previousFetch
  }
})

type MockOllamaFetchOptions = {
  capabilities?: string[]
  chunks?: unknown[]
  chatResponse?: Response
  onChatRequest?: (body: Record<string, any>) => void
}

function createMockOllamaFetch({
  capabilities = ['completion', 'tools'],
  chunks = [
    {
      message: { role: 'assistant', content: 'ok' },
      done: true,
      done_reason: 'stop',
    },
  ],
  chatResponse,
  onChatRequest,
}: MockOllamaFetchOptions): typeof globalThis.fetch {
  return (async (input, init) => {
    const url = String(input)
    if (url.endsWith('/api/show')) {
      return new Response(JSON.stringify({ capabilities }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.endsWith('/api/chat')) {
      const body = JSON.parse(String(init?.body))
      onChatRequest?.(body)
      return chatResponse ?? ndjsonResponse(chunks)
    }
    throw new Error(`Unexpected Ollama test URL: ${url}`)
  }) as typeof globalThis.fetch
}

async function createStreamingOllamaResponse(options?: {
  model?: string
  messages?: any[]
  requestOptions?: { timeout?: number }
  thinking?: unknown
  tools?: unknown[]
}) {
  const client = createOllamaURHQClient() as any
  return client.beta.messages
    .create(
      {
        model: options?.model ?? 'minimax-m3:cloud',
        messages: options?.messages ?? [{ role: 'user', content: 'hi' }],
        max_tokens: 10,
        stream: true,
        ...(options?.thinking !== undefined ? { thinking: options.thinking } : {}),
        ...(options?.tools !== undefined ? { tools: options.tools } : {}),
      },
      options?.requestOptions,
    )
    .withResponse()
}

function ndjsonResponse(chunks: unknown[]): Response {
  return new Response(`${chunks.map(chunk => JSON.stringify(chunk)).join('\n')}\n`, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson' },
  })
}
