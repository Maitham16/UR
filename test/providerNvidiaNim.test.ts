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
  validateProviderModelPair,
} from '../src/services/providers/providerRegistry.js'
import {
  getNvidiaHostedAgentModelContract,
  getNvidiaHostedTaskModelContract,
  NVIDIA_BUILD_EXECUTABLE_ENDPOINT_COUNT,
  NVIDIA_BUILD_FREE_ENDPOINT_COUNT,
  NVIDIA_BUILD_INDEX_MODEL_COUNT,
  NVIDIA_HOSTED_CHAT_ENDPOINT,
  nvidiaHostedAgentModelIds,
  nvidiaHostedTaskModelIds,
  resolveNvidiaHostedModelEndpoint,
} from '../src/services/providers/nvidiaHostedModels.js'
import {
  getProviderEffortWireValue,
  getSupportedEffortLevelsForModel,
} from '../src/utils/effort.js'
import { SettingsSchema } from '../src/utils/settings/types.js'
import { providerSupportsThinkingToggle } from '../src/utils/thinking.js'

beforeEach(() => clearProviderModelCacheForTests())
afterEach(() => clearProviderModelCacheForTests())

describe('NVIDIA Agentic and NVIDIA Special providers', () => {
  test('registers two providers backed by one NVIDIA_API_KEY', () => {
    expect(resolveProviderId('NVIDIA Build')).toBe('nvidia-nim')
    expect(resolveProviderId('NVIDIA Agentic')).toBe('nvidia-nim')
    expect(resolveProviderId('NVIDIA Special')).toBe('nvidia-special')
    expect(getProviderFamily('nvidia-nim')).toBe('openai-compatible')
    expect(getProviderFamily('nvidia-special')).toBe('openai-compatible')
    expect(getProviderRuntimeBackend('nvidia-nim')).toBe('api:nvidia-nim')
    expect(getProviderRuntimeBackend('nvidia-special')).toBe('api:nvidia-special')
    expect(getProviderDefinition('nvidia-nim')).toMatchObject({
      displayName: 'NVIDIA Agentic',
      envKey: 'NVIDIA_API_KEY',
      defaultBaseUrl: 'https://integrate.api.nvidia.com/v1',
      endpointKind: 'openai-compatible',
    })
    expect(getProviderDefinition('nvidia-special')).toMatchObject({
      displayName: 'NVIDIA Special',
      envKey: 'NVIDIA_API_KEY',
      listModels: 'static',
    })
    expect(
      SettingsSchema().safeParse({
        provider: {
          active: 'nvidia-special',
          baseUrls: {
            'nvidia-nim': 'https://nim-gateway.example/v1',
            ollama: 'http://localhost:11434',
          },
        },
      }).success,
    ).toBe(true)
  })

  test('preserves exact parity with the current NVIDIA Build index', () => {
    const agents = nvidiaHostedAgentModelIds().map(model =>
      getNvidiaHostedAgentModelContract(model),
    )
    const tasks = nvidiaHostedTaskModelIds().map(model =>
      getNvidiaHostedTaskModelContract(model),
    )

    expect(NVIDIA_BUILD_INDEX_MODEL_COUNT).toBe(100)
    expect(NVIDIA_BUILD_FREE_ENDPOINT_COUNT).toBe(36)
    expect(NVIDIA_BUILD_EXECUTABLE_ENDPOINT_COUNT).toBe(35)
    expect(agents).toHaveLength(13)
    expect(tasks).toHaveLength(23)
    expect(agents.length + tasks.length).toBe(NVIDIA_BUILD_FREE_ENDPOINT_COUNT)
    expect(new Set([...nvidiaHostedAgentModelIds(), ...nvidiaHostedTaskModelIds()]).size).toBe(
      NVIDIA_BUILD_FREE_ENDPOINT_COUNT,
    )
    expect(
      [...agents, ...tasks].every(
        contract =>
          contract &&
          contract.endpoint &&
          contract.method &&
          contract.documentation &&
          contract.buildCard &&
          contract.purpose &&
          contract.inputHint &&
          contract.outputHint &&
          contract.requestSchema &&
          contract.responseSchema,
      ),
    ).toBe(true)
    expect(agents.every(contract => contract?.supportedParameters.includes('tools'))).toBe(true)
    expect(tasks.every(contract => contract?.taskKind && !contract.agent)).toBe(true)
  })

  test('public Agentic discovery is generated from cards and never filtered by account inventory', async () => {
    let fetched = false
    const result = await listModelsForProviderWithSource('nvidia-nim', {
      freshOnly: true,
      adapters: {
        env: { NVIDIA_API_KEY: 'nvapi-test' },
        fetch: async () => {
          fetched = true
          return Response.json({ data: [] })
        },
      },
    })

    expect(fetched).toBe(false)
    expect(result.source).toBe('live')
    expect(result.models.map(model => model.id).sort()).toEqual(
      nvidiaHostedAgentModelIds().sort(),
    )
    expect(result.models.every(model => model.usageMode !== 'task')).toBe(true)
    expect(result.models.every(model => model.supportedParameters?.includes('tools'))).toBe(true)
    expect(result.models[0]).toMatchObject({
      id: 'nvidia/nemotron-3.5-lightning-30b-a3b',
      isDefault: true,
    })
  })

  test('Special discovery exposes every focused-task card with exact transport guidance', async () => {
    let fetched = false
    const result = await listModelsForProviderWithSource('nvidia-special', {
      freshOnly: true,
      adapters: {
        env: { NVIDIA_API_KEY: 'nvapi-test' },
        fetch: async () => {
          fetched = true
          return Response.json({})
        },
      },
    })

    expect(fetched).toBe(false)
    expect(result.models.map(model => model.id)).toEqual(nvidiaHostedTaskModelIds())
    expect(result.models.every(model => model.usageMode === 'task')).toBe(true)
    expect(getNvidiaHostedTaskModelContract('google/paligemma')).toMatchObject({
      endpoint: 'https://ai.api.nvidia.com/v1/vlm/google/paligemma',
      method: 'POST',
      transport: 'http',
      executable: true,
      taskKind: 'image-understanding',
    })
    expect(getNvidiaHostedTaskModelContract('nvidia/magpie-tts-zeroshot')).toMatchObject({
      endpoint: 'grpc.nvcf.nvidia.com:443',
      method: 'UNARY',
      rpcService: 'nvidia.riva.tts.RivaSpeechSynthesis',
      rpcMethod: 'Synthesize',
      executable: true,
    })
    expect(getNvidiaHostedTaskModelContract('nvidia/nemotron-voicechat')).toMatchObject({
      transport: 'unpublished',
      method: 'UNPUBLISHED',
      available: false,
      executable: false,
    })
  })

  test('preserves a configurable enterprise NIM gateway', async () => {
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
    expect(result.models.map(model => model.id)).toEqual(['enterprise/private-chat-model'])
    expect(requests).toEqual(['https://nim.example/v1/models'])
  })

  test('resolves only exact card endpoints on the public hosted API', () => {
    expect(
      resolveNvidiaHostedModelEndpoint(
        'https://integrate.api.nvidia.com/v1',
        'meta/muse-glimmer-30b',
      ),
    ).toBe(NVIDIA_HOSTED_CHAT_ENDPOINT)
    expect(
      resolveNvidiaHostedModelEndpoint(
        'https://integrate.api.nvidia.com/v1',
        'google/paligemma',
      ),
    ).toBeUndefined()
    expect(
      resolveNvidiaHostedModelEndpoint(
        'https://enterprise-nim.example/v1',
        'meta/muse-glimmer-30b',
      ),
    ).toBeUndefined()
  })

  test('preserves NVIDIA-advertised effort and thinking controls', () => {
    expect(
      getSupportedEffortLevelsForModel('moonshotai/kimi-k3', 'nvidia-nim'),
    ).toEqual(['low', 'high', 'max', 'ultra'])
    expect(
      getProviderEffortWireValue('moonshotai/kimi-k3', 'ultra', 'nvidia-nim'),
    ).toBe('max')
    expect(
      providerSupportsThinkingToggle(
        'nvidia-nim',
        'nvidia/nemotron-3.5-lightning-30b-a3b',
      ),
    ).toBe(true)
  })

  test('doctor reports the full card-backed Agentic and Special counts', async () => {
    const result = await doctorProvider('nvidia-nim', {
      settings: {
        provider: { active: 'nvidia-nim', model: 'moonshotai/kimi-k3' },
      },
      adapters: {
        env: { NVIDIA_API_KEY: 'nvapi-test' },
        fetch: async () => Response.json({ data: [{ id: 'moonshotai/kimi-k3' }] }),
      },
    })

    expect(result.ok).toBe(true)
    expect(result.checks).toContainEqual({
      name: 'chat_models',
      status: 'pass',
      message: '13 NVIDIA Agentic models are selectable.',
    })
    expect(result.checks).toContainEqual({
      name: 'task_models',
      status: 'pass',
      message:
        '23 NVIDIA Special entries are preserved from Build; 22 publish executable exact-endpoint contracts and key entitlement is checked only when invoked.',
    })
  })

  test('routes native tool requests without a model-list preflight', async () => {
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
    expect(request.chat_template_kwargs).toEqual({ force_nonempty_content: true })
    expect(request.tools[0].function.name).toBe('FileRead')

    const seen: Array<{ url: string; authorization: string | null; body: any }> = []
    const client = await createProviderClient('nvidia-nim', {
      apiKey: 'nvapi-test',
      model: 'nvidia/nemotron-3-super-120b-a12b',
      fetchOverride: (async (input, init) => {
        seen.push({
          url: String(input),
          authorization: new Headers(init?.headers).get('authorization'),
          body: JSON.parse(String(init?.body)),
        })
        return Response.json({
          id: 'chatcmpl-nvidia',
          model: 'nvidia/nemotron-3-super-120b-a12b',
          choices: [{ message: { content: 'ready' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 1 },
        })
      }) as typeof fetch,
    })
    const response = await client.beta.messages.create({
      model: 'nvidia/nemotron-3-super-120b-a12b',
      messages: [{ role: 'user', content: 'Reply ready.' }],
      max_tokens: 16,
    })

    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      url: NVIDIA_HOSTED_CHAT_ENDPOINT,
      authorization: 'Bearer nvapi-test',
      body: { model: 'nvidia/nemotron-3-super-120b-a12b' },
    })
    expect((response as any).content[0].text).toBe('ready')
  })

  test('redacts account identifiers but never prunes a rejected model', async () => {
    const client = await createOpenAICompatibleClient({
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKey: 'nvapi-test',
      providerId: 'nvidia-nim',
      maxRetries: 0,
      fetch: async () =>
        Response.json(
          {
            status: 404,
            detail:
              "Function '23bd454d-b225-49a3-8118-582a62fc51b8': Not found for account 'VSB91X1Z9SXUUs3B5SLm16YDcaBh5gNB2kOOsW8Sdxo'",
          },
          { status: 404 },
        ),
    })

    let caught: unknown
    try {
      await client.beta.messages.create({
        model: 'openai/gpt-oss-20b',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 8,
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ProviderHTTPError)
    expect((caught as Error).message).toContain('UR kept it in the catalog')
    expect((caught as Error).message).not.toContain('23bd454d')
    expect((caught as Error).message).not.toContain('VSB91X1')
    expect((caught as ProviderHTTPError).body).toBeUndefined()

    const afterFailure = await listModelsForProviderWithSource('nvidia-nim', {
      adapters: { env: { NVIDIA_API_KEY: 'nvapi-test' } },
    })
    expect(afterFailure.models.map(model => model.id)).toContain('openai/gpt-oss-20b')
    expect(afterFailure.models).toHaveLength(nvidiaHostedAgentModelIds().length)
  })

  test('keeps focused tasks out of the ongoing agent loop', async () => {
    const special = await listModelsForProviderWithSource('nvidia-special')
    const validation = validateProviderModelPair('nvidia-nim', 'google/paligemma', {
      availableModels: special.models,
    })
    expect(validation.valid).toBe(false)
    if (validation.valid === false) {
      expect(validation.error).toContain('one-shot image-understanding model')
    }

    let fetched = false
    const client = await createOpenAICompatibleClient({
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKey: 'nvapi-test',
      providerId: 'nvidia-nim',
      fetch: async () => {
        fetched = true
        return Response.json({})
      },
    })
    await expect(
      client.beta.messages.create({
        model: 'google/paligemma',
        messages: [{ role: 'user', content: 'Use a tool.' }],
        max_tokens: 8,
      }),
    ).rejects.toThrow('has no documented Agentic endpoint')
    expect(fetched).toBe(false)
  })
})
