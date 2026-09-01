import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  createOpenAICompatibleClient,
  toOpenAICompatibleRequest,
} from '../src/services/api/openaiCompatible.js'
import { createOpenAIResponsesClient } from '../src/services/api/openaiResponses.js'
import { createOpenRouterClient } from '../src/services/api/openrouter.js'
import {
  buildTokenCountRequest,
  createStandardAPIClient,
  parseProviderTokenCount,
} from '../src/services/api/standardAPI.js'
import { parseModelReasoningCapabilities } from '../src/services/providers/modelCatalog.js'
import {
  cacheProviderModelsForProvider,
  clearProviderModelCacheForTests,
} from '../src/services/providers/providerRegistry.js'
import {
  modelSupportsAdaptiveThinking,
  modelSupportsThinking,
} from '../src/utils/thinking.js'

const params = {
  model: 'future-model',
  system: [{ type: 'text', text: 'Be concise.' }],
  messages: [{ role: 'user', content: 'Count this request.' }],
  tools: [
    {
      name: 'lookup',
      description: 'Look up a value',
      input_schema: {
        type: 'object',
        properties: { key: { type: 'string' } },
        required: ['key'],
      },
    },
  ],
  max_tokens: 2048,
  thinking: { type: 'adaptive' },
}

describe('provider-native token counting', () => {
  test('builds the OpenAI Responses input-token request', () => {
    const request = buildTokenCountRequest(
      'openai',
      'https://example.test/v1',
      params,
      'openai-api',
    )

    expect(request.endpoint).toBe(
      'https://example.test/v1/responses/input_tokens',
    )
    expect(request.body.model).toBe('future-model')
    expect(request.body.instructions).toBe('Be concise.')
    expect(Array.isArray(request.body.input)).toBe(true)
    expect(Array.isArray(request.body.tools)).toBe(true)
    expect(request.body).not.toHaveProperty('max_output_tokens')
    expect(request.body).not.toHaveProperty('stream')
    expect(request.body).not.toHaveProperty('store')
  })

  test('builds Anthropic Messages count without generation-only fields', () => {
    const request = buildTokenCountRequest(
      'anthropic',
      'https://example.test/v1',
      params,
      'anthropic-api',
    )

    expect(request.endpoint).toBe(
      'https://example.test/v1/messages/count_tokens',
    )
    expect(request.body.model).toBe('future-model')
    expect(request.body.thinking).toEqual({ type: 'adaptive' })
    expect(request.body).not.toHaveProperty('max_tokens')
    expect(request.body).not.toHaveProperty('stream')
  })

  test('builds Gemini countTokens from the translated GenerateContent request', () => {
    const request = buildTokenCountRequest(
      'google',
      'https://example.test/v1beta',
      params,
      'gemini-api',
    )

    expect(request.endpoint).toBe(
      'https://example.test/v1beta/models/future-model:countTokens',
    )
    expect(request.body.generateContentRequest).toMatchObject({
      model: 'models/future-model',
      contents: [{ role: 'user', parts: [{ text: 'Count this request.' }] }],
    })
  })

  test('parses provider count response variants and rejects malformed counts', () => {
    expect(parseProviderTokenCount('openai', { input_tokens: 17 })).toBe(17)
    expect(parseProviderTokenCount('anthropic', { input_tokens: 19 })).toBe(19)
    expect(parseProviderTokenCount('google', { totalTokens: 23 })).toBe(23)
    expect(() => parseProviderTokenCount('google', { totalTokens: -1 })).toThrow(
      'omitted a valid count',
    )
  })

  test('uses the native standard-provider endpoint and identifies its source', async () => {
    let requestUrl = ''
    const client = await createStandardAPIClient({
      providerId: 'anthropic-api',
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1',
      maxRetries: 0,
      fetch: async input => {
        requestUrl = String(input)
        return Response.json({ input_tokens: 31 })
      },
    })

    const result = await client.beta.messages.countTokens(params)
    expect(requestUrl).toBe('https://example.test/v1/messages/count_tokens')
    expect(result).toEqual({ input_tokens: 31, source: 'provider' })
  })

  test('uses the OpenAI Responses input-token endpoint without generating', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const client = await createOpenAIResponsesClient({
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1',
      maxRetries: 0,
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        })
        return Response.json({ input_tokens: 33 })
      },
    })

    expect(await client.beta.messages.countTokens?.(params)).toEqual({
      input_tokens: 33,
      source: 'provider',
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe(
      'https://example.test/v1/responses/input_tokens',
    )
    expect(requests[0]?.body).not.toHaveProperty('max_output_tokens')
  })

  test('uses llama.cpp and vLLM non-generating count endpoints', async () => {
    const requests: string[] = []
    const fetch = async (input: RequestInfo | URL) => {
      requests.push(String(input))
      return Response.json({ input_tokens: 37 })
    }
    const llama = await createOpenAICompatibleClient({
      baseUrl: 'http://127.0.0.1:8080/v1',
      providerId: 'llama.cpp',
      maxRetries: 0,
      fetch,
    })
    const vllm = await createOpenAICompatibleClient({
      baseUrl: 'http://127.0.0.1:8000/v1',
      providerId: 'vllm',
      maxRetries: 0,
      fetch,
    })

    expect(await llama.beta.messages.countTokens(params)).toEqual({
      input_tokens: 37,
      source: 'provider',
    })
    expect(await vllm.beta.messages.countTokens(params)).toEqual({
      input_tokens: 37,
      source: 'provider',
    })
    expect(requests).toEqual([
      'http://127.0.0.1:8080/v1/chat/completions/input_tokens',
      'http://127.0.0.1:8000/v1/messages/count_tokens',
    ])
  })

  test('falls back to an explicit local estimate without inference', async () => {
    let requests = 0
    const client = await createOpenAICompatibleClient({
      baseUrl: 'http://127.0.0.1:1234/v1',
      providerId: 'lmstudio',
      maxRetries: 0,
      fetch: async () => {
        requests += 1
        throw new Error('must not generate')
      },
    })

    const result = await client.beta.messages.countTokens(params)
    expect(result.source).toBe('local-estimate')
    expect(result.input_tokens).toBeGreaterThan(0)
    expect(requests).toBe(0)
  })

  test('OpenRouter counts the translated request locally without an API call', async () => {
    const client = await createOpenRouterClient({
      apiKey: 'test-key',
      maxRetries: 0,
    })

    const result = await client.beta.messages.countTokens(params)
    expect(result.source).toBe('local-estimate')
    expect(result.input_tokens).toBeGreaterThan(0)
  })

  test('NVIDIA NIM avoids its unsupported hosted token-count route', async () => {
    let requests = 0
    const client = await createOpenAICompatibleClient({
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      providerId: 'nvidia-nim',
      apiKey: 'test-key',
      maxRetries: 0,
      fetch: async () => {
        requests += 1
        throw new Error('NVIDIA hosted NIM has no documented count endpoint')
      },
    })

    const result = await client.beta.messages.countTokens(params)
    expect(result.source).toBe('local-estimate')
    expect(result.input_tokens).toBeGreaterThan(0)
    expect(requests).toBe(0)
  })
})

describe('future-model thinking capability discovery', () => {
  beforeEach(() => clearProviderModelCacheForTests())
  afterEach(() => clearProviderModelCacheForTests())

  test('normalizes explicit boolean thinking capability metadata', () => {
    expect(
      parseModelReasoningCapabilities({ supports_thinking: true }),
    ).toEqual({ supportsThinking: true })
    expect(
      parseModelReasoningCapabilities({ supportsThinking: false }),
    ).toEqual({ supportsThinking: false })
  })

  test('uses provider-authored boolean metadata without inventing adaptive effort', () => {
    cacheProviderModelsForProvider('openrouter', [
      {
        id: 'vendor/future-model',
        displayName: 'Future Model',
        description: 'Live model',
        reasoning: { supportsThinking: true },
      },
    ])

    expect(modelSupportsThinking('vendor/future-model', 'openrouter')).toBe(true)
    expect(
      modelSupportsAdaptiveThinking('vendor/future-model', 'openrouter'),
    ).toBe(false)
    expect(
      toOpenAICompatibleRequest(
        {
          model: 'vendor/future-model',
          messages: [],
          thinking: { type: 'enabled', budget_tokens: 12_000 },
        },
        'openrouter',
      ).reasoning,
    ).toEqual({ enabled: true })
  })

  test('uses a provider-advertised token budget without fabricating effort', () => {
    cacheProviderModelsForProvider('openrouter', [
      {
        id: 'vendor/budget-reasoner',
        displayName: 'Budget Reasoner',
        description: 'Live model',
        reasoning: { supportsMaxTokens: true },
      },
    ])

    expect(modelSupportsThinking('vendor/budget-reasoner', 'openrouter')).toBe(
      true,
    )
    expect(
      modelSupportsAdaptiveThinking('vendor/budget-reasoner', 'openrouter'),
    ).toBe(false)
    expect(
      toOpenAICompatibleRequest(
        {
          model: 'vendor/budget-reasoner',
          messages: [],
          thinking: { type: 'enabled', budget_tokens: 12_345 },
        },
        'openrouter',
      ).reasoning,
    ).toEqual({ max_tokens: 12_345 })
  })

  test('keeps unknown and explicitly unsupported models disabled', () => {
    cacheProviderModelsForProvider('ollama', [
      {
        id: 'plain-model',
        displayName: 'Plain Model',
        description: 'Live model',
        reasoning: { supportsThinking: false, supportedEfforts: [] },
      },
    ])

    expect(modelSupportsThinking('plain-model', 'ollama')).toBe(false)
    expect(modelSupportsThinking('never-seen-model', 'ollama')).toBe(false)
    expect(modelSupportsThinking('never-seen-model', 'openai-api')).toBe(false)
    expect(modelSupportsThinking('vendor/gpt-5.6-sol-unknown', 'openai-api')).toBe(
      false,
    )
  })

  test('keeps curated graded models enabled', () => {
    expect(modelSupportsThinking('gpt-5.6-sol', 'openai-api')).toBe(true)
    expect(modelSupportsAdaptiveThinking('gpt-5.6-sol', 'openai-api')).toBe(true)
  })
})
