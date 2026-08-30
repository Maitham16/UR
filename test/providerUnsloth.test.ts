import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  createProviderClient,
} from '../src/services/api/providerClient.js'
import {
  toOpenAICompatibleRequest,
} from '../src/services/api/openaiCompatible.js'
import {
  cacheProviderModelsForProvider,
  clearProviderModelCacheForTests,
  doctorProvider,
  getProviderDefinition,
  getProviderFamily,
  getProviderRuntimeBackend,
  listModelsForProviderWithSource,
  resolveProviderId,
} from '../src/services/providers/providerRegistry.js'
import { SettingsSchema } from '../src/utils/settings/types.js'

beforeEach(() => clearProviderModelCacheForTests())
afterEach(() => clearProviderModelCacheForTests())

describe('Unsloth provider-only integration', () => {
  test('registers an authenticated UR-native OpenAI-compatible server', () => {
    expect(resolveProviderId('Unsloth Studio')).toBe('unsloth')
    expect(getProviderFamily('unsloth')).toBe('openai-compatible')
    expect(getProviderRuntimeBackend('unsloth')).toBe(
      'openai-compatible:unsloth',
    )
    expect(getProviderDefinition('unsloth')).toMatchObject({
      accessType: 'server',
      runtimeKind: 'ur-native',
      envKey: 'UNSLOTH_API_KEY',
      requiresApiKey: true,
      defaultBaseUrl: 'http://localhost:8888/v1',
    })
    expect(
      SettingsSchema().safeParse({
        provider: {
          active: 'unsloth',
          model: 'local-model',
          baseUrls: {
            ollama: 'http://localhost:11434',
            unsloth: 'http://localhost:8888/v1',
          },
        },
      }).success,
    ).toBe(true)
  })

  test('always disables Unsloth server-side tools while preserving UR tool calls', () => {
    const tool = {
      name: 'FileRead',
      description: 'Read a file through UR.',
      input_schema: {
        type: 'object',
        properties: { file_path: { type: 'string' } },
        required: ['file_path'],
      },
    }
    for (const stream of [false, true]) {
      const request = toOpenAICompatibleRequest(
        {
          model: 'local-model',
          messages: [{ role: 'user', content: 'Read package.json' }],
          tools: [tool],
          tool_choice: { type: 'tool', name: 'FileRead' },
          stream,
        },
        'unsloth',
      )
      expect(request.enable_tools).toBe(false)
      expect(request.tools[0].function.name).toBe('FileRead')
      expect(request.tool_choice).toEqual({
        type: 'function',
        function: { name: 'FileRead' },
      })
    }
    expect(
      toOpenAICompatibleRequest(
        { model: 'x', messages: [], stream: false },
        'vllm',
      ).enable_tools,
    ).toBeUndefined()
  })

  test('discovers models with bearer authentication', async () => {
    const requests: Array<{ url: string; authorization: string | null }> = []
    const result = await listModelsForProviderWithSource('unsloth', {
      settings: { provider: { active: 'unsloth' } },
      adapters: {
        env: { UNSLOTH_API_KEY: 'studio-test-key' },
        fetch: async (input, init) => {
          const headers = new Headers(init?.headers)
          requests.push({
            url: String(input),
            authorization: headers.get('authorization'),
          })
          return new Response(
            JSON.stringify({ data: [{ id: 'unsloth/Qwen3-Coder' }] }),
            { status: 200 },
          )
        },
      },
    })

    expect(requests).toEqual([
      {
        url: 'http://localhost:8888/v1/models',
        authorization: 'Bearer studio-test-key',
      },
    ])
    expect(result.source).toBe('live')
    expect(result.models.map(model => model.id)).toEqual([
      'unsloth/Qwen3-Coder',
    ])
  })

  test('requires a Studio key before discovery or inference', async () => {
    let fetched = false
    const doctor = await doctorProvider('unsloth', {
      settings: { provider: { active: 'unsloth' } },
      adapters: {
        env: {},
        fetch: async () => {
          fetched = true
          return new Response('{}')
        },
      },
    })
    expect(doctor.ok).toBe(false)
    expect(doctor.failureReason).toBe('API key missing')
    expect(fetched).toBe(false)

    cacheProviderModelsForProvider('unsloth', ['local-model'])
    await expect(
      createProviderClient('unsloth', {
        apiKey: '',
        model: 'local-model',
      }),
    ).rejects.toThrow(/UNSLOTH_API_KEY/)
  })

  test('routes authenticated inference and native tool calls through UR', async () => {
    cacheProviderModelsForProvider('unsloth', ['local-model'])
    const originalFetch = globalThis.fetch
    const seen: Array<{ url: string; authorization: string | null; body: any }> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      seen.push({
        url: String(input),
        authorization: headers.get('authorization'),
        body: JSON.parse(String(init?.body)),
      })
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-unsloth',
          model: 'local-model',
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'FileRead',
                      arguments: '{"file_path":"package.json"}',
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 8, completion_tokens: 4 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch

    try {
      const client = await createProviderClient('unsloth', {
        apiKey: 'studio-test-key',
        model: 'local-model',
      })
      expect((client as any).__urProviderId).toBe('unsloth')
      expect((client as any).__urRuntimeBackend).toBe(
        'openai-compatible:unsloth',
      )

      const response = await client.beta.messages.create({
        model: 'local-model',
        messages: [{ role: 'user', content: 'Read package.json' }],
        max_tokens: 64,
        tools: [
          {
            name: 'FileRead',
            description: 'Read a file through UR.',
            input_schema: {
              type: 'object',
              properties: { file_path: { type: 'string' } },
              required: ['file_path'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'FileRead' },
      })

      expect(seen).toHaveLength(1)
      expect(seen[0]).toMatchObject({
        url: 'http://localhost:8888/v1/chat/completions',
        authorization: 'Bearer studio-test-key',
        body: { model: 'local-model', enable_tools: false },
      })
      expect((response as any).stop_reason).toBe('tool_use')
      expect((response as any).content[0]).toMatchObject({
        type: 'tool_use',
        name: 'FileRead',
        input: { file_path: 'package.json' },
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('streams normally while keeping Unsloth server tools disabled', async () => {
    cacheProviderModelsForProvider('unsloth', ['local-model'])
    const originalFetch = globalThis.fetch
    let requestBody: any
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body))
      const encoder = new TextEncoder()
      return new Response(
        new ReadableStream({
          start(controller) {
            for (const chunk of [
              'data: {"id":"unsloth-stream","model":"local-model","choices":[{"delta":{"content":"A"},"index":0}]}\n\n',
              'data: {"id":"unsloth-stream","model":"local-model","choices":[{"delta":{"content":"B"},"index":0}]}\n\n',
              'data: {"id":"unsloth-stream","model":"local-model","choices":[{"delta":{},"index":0,"finish_reason":"stop"}]}\n\n',
              'data: [DONE]\n\n',
            ]) {
              controller.enqueue(encoder.encode(chunk))
            }
            controller.close()
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      )
    }) as typeof fetch

    try {
      const client = await createProviderClient('unsloth', {
        apiKey: 'studio-test-key',
        model: 'local-model',
      })
      const streamed = await client.beta.messages.create({
        model: 'local-model',
        messages: [{ role: 'user', content: 'Reply AB' }],
        max_tokens: 16,
        stream: true,
      })
      const { data } = await (streamed as any).withResponse()
      const text: string[] = []
      let stopped = false
      for await (const event of data) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          text.push(event.delta.text)
        }
        if (event.type === 'message_stop') stopped = true
      }
      expect(requestBody).toMatchObject({
        model: 'local-model',
        stream: true,
        enable_tools: false,
      })
      expect(text).toEqual(['A', 'B'])
      expect(stopped).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
