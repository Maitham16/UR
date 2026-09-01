import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createProviderClient } from '../src/services/api/providerClient.js'
import {
  createOpenAICompatibleClient,
  toOpenAICompatibleRequest,
} from '../src/services/api/openaiCompatible.js'
import { ProviderHTTPError } from '../src/services/api/providerHttp.js'
import {
  clearProviderModelCacheForTests,
  doctorProvider,
  getProviderDefinition,
  getProviderFamily,
  getProviderRuntimeBackend,
  listModelsForProviderWithSource,
  resolveProviderId,
} from '../src/services/providers/providerRegistry.js'
import {
  getProviderEffortWireValue,
  getSupportedEffortLevelsForModel,
} from '../src/utils/effort.js'
import { SettingsSchema } from '../src/utils/settings/types.js'
import { providerSupportsThinkingToggle } from '../src/utils/thinking.js'

beforeEach(() => clearProviderModelCacheForTests())
afterEach(() => clearProviderModelCacheForTests())

describe('NVIDIA NIM provider integration', () => {
  test('registers the hosted API and preserves a configurable NIM endpoint', () => {
    expect(resolveProviderId('NVIDIA Build')).toBe('nvidia-nim')
    expect(resolveProviderId('nim')).toBe('nvidia-nim')
    expect(getProviderFamily('nvidia-nim')).toBe('openai-compatible')
    expect(getProviderRuntimeBackend('nvidia-nim')).toBe('api:nvidia-nim')
    expect(getProviderDefinition('nvidia-nim')).toMatchObject({
      accessType: 'api',
      runtimeKind: 'ur-native',
      envKey: 'NVIDIA_API_KEY',
      requiresApiKey: true,
      defaultBaseUrl: 'https://integrate.api.nvidia.com/v1',
      endpointKind: 'openai-compatible',
    })
    expect(
      SettingsSchema().safeParse({
        provider: {
          active: 'nvidia-nim',
          model: 'nvidia/model',
          baseUrls: {
            'nvidia-nim': 'https://nim-gateway.example/v1',
            ollama: 'http://localhost:11434',
          },
        },
      }).success,
    ).toBe(true)
  })

  test('uses the hosted models endpoint as the live catalog and enriches only documented effort contracts', async () => {
    const requests: Array<{ url: string; authorization: string | null }> = []
    const result = await listModelsForProviderWithSource('nvidia-nim', {
      adapters: {
        env: { NVIDIA_API_KEY: 'nvapi-test' },
        fetch: async (input, init) => {
          const headers = new Headers(init?.headers)
          requests.push({
            url: String(input),
            authorization: headers.get('authorization'),
          })
          return Response.json({
            data: [
              { id: '01-ai/yi-large' },
              { id: 'deepseek-ai/deepseek-v4-flash' },
              { id: 'nvidia/nemotron-3.5-lightning-30b-a3b' },
              { id: 'nvidia/nemotron-parse' },
              { id: 'vendor/future-model', supported_parameters: ['reasoning_effort'] },
            ],
          })
        },
      },
    })

    expect(requests).toEqual([
      {
        url: 'https://integrate.api.nvidia.com/v1/models',
        authorization: 'Bearer nvapi-test',
      },
    ])
    expect(result.source).toBe('live')
    expect(result.models.map(model => model.id)).toEqual([
      'nvidia/nemotron-3.5-lightning-30b-a3b',
      '01-ai/yi-large',
      'deepseek-ai/deepseek-v4-flash',
      'vendor/future-model',
    ])
    expect(
      getSupportedEffortLevelsForModel(
        'deepseek-ai/deepseek-v4-flash',
        'nvidia-nim',
      ),
    ).toEqual(['minimal', 'high', 'max', 'ultra'])
    expect(
      getProviderEffortWireValue(
        'deepseek-ai/deepseek-v4-flash',
        'ultra',
        'nvidia-nim',
      ),
    ).toBe('max')
    expect(
      getSupportedEffortLevelsForModel('vendor/future-model', 'nvidia-nim'),
    ).toEqual([])
    expect(result.models[0]).toMatchObject({
      isDefault: true,
      reasoning: { supportsThinking: true, defaultEnabled: true },
    })
    expect(
      providerSupportsThinkingToggle(
        'nvidia-nim',
        'nvidia/nemotron-3.5-lightning-30b-a3b',
      ),
    ).toBe(true)
    expect(
      providerSupportsThinkingToggle('nvidia-nim', 'moonshotai/kimi-k3'),
    ).toBe(false)
    expect(
      getSupportedEffortLevelsForModel('moonshotai/kimi-k3', 'nvidia-nim'),
    ).toEqual(['low', 'high', 'max', 'ultra'])
    expect(
      getProviderEffortWireValue(
        'moonshotai/kimi-k3',
        'ultra',
        'nvidia-nim',
      ),
    ).toBe('max')
  })

  test('does not apply the hosted account inventory to a configured NIM gateway', async () => {
    const requests: string[] = []
    const result = await listModelsForProviderWithSource('nvidia-nim', {
      settings: {
        provider: {
          active: 'nvidia-nim',
          baseUrls: { 'nvidia-nim': 'https://nim.example/v1' },
        },
      },
      adapters: {
        env: { NVIDIA_API_KEY: 'enterprise-key' },
        fetch: async input => {
          requests.push(String(input))
          return Response.json({ data: [{ id: 'enterprise/private-chat-model' }] })
        },
      },
    })

    expect(result.source).toBe('live')
    expect(result.models.map(model => model.id)).toEqual([
      'enterprise/private-chat-model',
    ])
    expect(requests).toEqual(['https://nim.example/v1/models'])
  })

  test('does not depend on the separate NVCF function inventory', async () => {
    const requests: string[] = []
    const result = await listModelsForProviderWithSource('nvidia-nim', {
      freshOnly: true,
      adapters: {
        env: { NVIDIA_API_KEY: 'nvapi-test' },
        fetch: async input => {
          requests.push(String(input))
          return Response.json({ data: [{ id: '01-ai/yi-large' }] })
        },
      },
    })

    expect(result.source).toBe('live')
    expect(result.models.map(model => model.id)).toEqual(['01-ai/yi-large'])
    expect(requests).toEqual(['https://integrate.api.nvidia.com/v1/models'])
  })

  test('doctor requires a key and probes a user-selected endpoint', async () => {
    let fetched = false
    const missing = await doctorProvider('nvidia-nim', {
      adapters: {
        env: {},
        getApiKey: () => undefined,
        fetch: async () => {
          fetched = true
          return new Response('{}')
        },
      },
    })
    expect(missing.ok).toBe(false)
    expect(missing.failureReason).toBe('API key missing')
    expect(fetched).toBe(false)

    const seen: string[] = []
    const connected = await doctorProvider('nvidia-nim', {
      settings: {
        provider: {
          active: 'nvidia-nim',
          baseUrls: { 'nvidia-nim': 'https://nim.example/v1' },
        },
      },
      adapters: {
        env: { NVIDIA_API_KEY: 'nvapi-test' },
        fetch: async input => {
          seen.push(String(input))
          return new Response(JSON.stringify({ data: [{ id: 'nvidia/model' }] }))
        },
      },
    })
    expect(connected.ok).toBe(true)
    expect(connected.baseUrl).toBe('https://nim.example/v1')
    expect(seen).toEqual(['https://nim.example/v1/models'])
  })

  test('doctor validates the selected model against the hosted models endpoint', async () => {
    const result = await doctorProvider('nvidia-nim', {
      settings: {
        provider: {
          active: 'nvidia-nim',
          model: '01-ai/yi-large',
        },
      },
      adapters: {
        env: { NVIDIA_API_KEY: 'nvapi-test' },
        fetch: async () => Response.json({
          data: [{ id: '01-ai/yi-large' }, { id: 'moonshotai/kimi-k3' }],
        }),
      },
    })

    expect(result.ok).toBe(true)
    expect(result.checks).toContainEqual({
      name: 'chat_models',
      status: 'pass',
      message: '2 NVIDIA hosted chat models are selectable.',
    })
    expect(result.checks).toContainEqual({
      name: 'model',
      status: 'pass',
      message: 'Model "01-ai/yi-large" is detectable.',
    })
  })

  test('routes chat, tools, images, streaming, and documented Nemotron agent options through the native adapter', async () => {
    const request = toOpenAICompatibleRequest(
      {
        model: 'nvidia/nemotron-3-super-120b-a12b',
        messages: [{ role: 'user', content: 'Use the tool.' }],
        tools: [
          {
            name: 'FileRead',
            description: 'Read a file.',
            input_schema: { type: 'object', properties: {} },
          },
        ],
        output_config: { effort: 'minimal' },
        stream: true,
      },
      'nvidia-nim',
    )
    expect(request.reasoning_effort).toBe('none')
    expect(request.chat_template_kwargs).toEqual({
      force_nonempty_content: true,
    })
    expect(request.stream).toBe(true)
    expect(request.tools[0].function.name).toBe('FileRead')

    const lightningOff = toOpenAICompatibleRequest(
      {
        model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
        messages: [{ role: 'user', content: 'Be quick.' }],
        thinking: { type: 'disabled' },
      },
      'nvidia-nim',
    )
    expect(lightningOff.chat_template_kwargs).toEqual({
      enable_thinking: false,
    })
    const lightningOn = toOpenAICompatibleRequest(
      {
        model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
        messages: [{ role: 'user', content: 'Reason.' }],
        thinking: { type: 'adaptive' },
      },
      'nvidia-nim',
    )
    expect(lightningOn.chat_template_kwargs).toEqual({
      enable_thinking: true,
    })

    const seen: Array<{ url: string; authorization: string | null; body: any }> = []
    const fetchOverride = (async (input, init) => {
      const url = String(input)
      const headers = new Headers(init?.headers)
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      seen.push({ url, authorization: headers.get('authorization'), body })
      if (url.endsWith('/models')) {
        return new Response(
          JSON.stringify({ data: [{ id: 'nvidia/nemotron-3-super-120b-a12b' }] }),
        )
      }
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-nvidia',
          model: 'nvidia/nemotron-3-super-120b-a12b',
          choices: [{ message: { content: 'ready' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 1 },
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch
    const client = await createProviderClient('nvidia-nim', {
      apiKey: 'nvapi-test',
      model: 'nvidia/nemotron-3-super-120b-a12b',
      fetchOverride,
    })
    const response = await client.beta.messages.create({
      model: 'nvidia/nemotron-3-super-120b-a12b',
      messages: [{ role: 'user', content: 'Reply ready.' }],
      max_tokens: 16,
    })
    expect((client as any).__urProviderId).toBe('nvidia-nim')
    expect((client as any).__urRuntimeBackend).toBe('api:nvidia-nim')
    expect(seen.map(entry => entry.url)).toEqual([
      'https://integrate.api.nvidia.com/v1/models',
      'https://integrate.api.nvidia.com/v1/chat/completions',
    ])
    expect(seen[1]).toMatchObject({
      authorization: 'Bearer nvapi-test',
      body: { model: 'nvidia/nemotron-3-super-120b-a12b' },
    })
    expect((response as any).content[0].text).toBe('ready')
  })

  test('redacts NVIDIA account/function identifiers and hides a runtime-rejected model', async () => {
    const apiBase = 'https://integrate.api.nvidia.com/v1'
    const modelsFetch = async (_input: RequestInfo | URL) =>
      Response.json({ data: [{ id: '01-ai/yi-large' }] })

    const discovered = await listModelsForProviderWithSource('nvidia-nim', {
      adapters: {
        env: { NVIDIA_API_KEY: 'nvapi-test' },
        fetch: modelsFetch,
      },
    })
    expect(discovered.models.map(model => model.id)).toEqual(['01-ai/yi-large'])

    const client = await createOpenAICompatibleClient({
      baseUrl: apiBase,
      apiKey: 'nvapi-test',
      providerId: 'nvidia-nim',
      maxRetries: 0,
      fetch: async () =>
        Response.json(
          {
            status: 404,
            title: 'Not Found',
            detail:
              "Function '23bd454d-b225-49a3-8118-582a62fc51b8': Not found for account 'VSB91X1Z9SXUUs3B5SLm16YDcaBh5gNB2kOOsW8Sdxo'",
          },
          { status: 404 },
        ),
    })

    for (const stream of [false, true]) {
      let caught: unknown
      try {
        const request = client.beta.messages.create({
          model: '01-ai/yi-large',
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 8,
          stream,
        })
        if (stream) {
          await request.withResponse()
        } else {
          await request
        }
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(ProviderHTTPError)
      expect((caught as Error).message).toContain(
        'NVIDIA NIM model "01-ai/yi-large" is unavailable to this account',
      )
      expect((caught as Error).message).not.toContain('23bd454d')
      expect((caught as Error).message).not.toContain('VSB91X1')
      expect((caught as ProviderHTTPError).body).toBeUndefined()
    }

    const afterFailure = await listModelsForProviderWithSource('nvidia-nim', {
      adapters: {
        env: { NVIDIA_API_KEY: 'nvapi-test' },
        fetch: modelsFetch,
      },
    })
    expect(afterFailure.models).toEqual([])
    expect(afterFailure.source).toBe('unavailable')
  })
})
