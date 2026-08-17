import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  clearProviderModelCacheForTests,
  ensureProviderReasoningCapabilitiesForModel,
  getProviderReasoningCapabilitiesForModel,
  getProviderRuntimeBlockReason,
  listModelsForProviderWithSource,
  listProviders,
  validateProviderModelPair,
} from '../src/services/providers/providerRegistry.js'
import {
  clearProviderApiKey,
  getStoredProviderApiKey,
  setProviderApiKey,
} from '../src/services/providers/providerCredentials.js'

let hadStoredOpenAiKey: string | undefined

beforeEach(() => {
  clearProviderModelCacheForTests()
  hadStoredOpenAiKey = getStoredProviderApiKey('openai-api')
  if (hadStoredOpenAiKey) clearProviderApiKey('openai-api')
})
afterEach(() => {
  clearProviderModelCacheForTests()
  if (hadStoredOpenAiKey) setProviderApiKey('openai-api', hadStoredOpenAiKey)
})

function fetchReturning(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch
}

describe('API provider live model discovery', () => {
  test('openai-api discovers models from /v1/models (data[].id)', async () => {
    const result = await listModelsForProviderWithSource('openai-api', {
      adapters: {
        env: { OPENAI_API_KEY: 'sk-test' },
        fetch: fetchReturning({ data: [{ id: 'gpt-5.5' }, { id: 'gpt-4o' }, { id: 'o3-mini' }] }),
      },
    })
    expect(result.source).toBe('live')
    expect(result.models.map(m => m.id)).toEqual(['gpt-4o', 'gpt-5.5', 'o3-mini']) // sorted, real
  })

  test('anthropic-api discovers models (Anthropic-native data[].id)', async () => {
    const result = await listModelsForProviderWithSource('anthropic-api', {
      adapters: {
        env: { ANTHROPIC_API_KEY: 'sk-ant' },
        fetch: fetchReturning({ data: [{ id: 'claude-opus-4-8', display_name: 'Opus' }] }),
      },
    })
    expect(result.source).toBe('live')
    expect(result.models.map(m => m.id)).toContain('claude-opus-4-8')
    expect(result.models[0]).toMatchObject({ displayName: 'claude-opus-4-8  (Opus)' })
  })

  test('anthropic-api follows guarded has_more/last_id pagination', async () => {
    const urls: string[] = []
    const result = await listModelsForProviderWithSource('anthropic-api', {
      adapters: {
        env: { ANTHROPIC_API_KEY: 'sk-ant' },
        fetch: (async input => {
          const url = String(input)
          urls.push(url)
          const after = new URL(url).searchParams.get('after_id')
          return new Response(JSON.stringify(after
            ? { data: [{ id: 'claude-page-2', max_input_tokens: 200000 }], has_more: false }
            : { data: [{ id: 'claude-page-1' }], has_more: true, last_id: 'claude-page-1' }))
        }) as typeof fetch,
      },
    })
    expect(result.models.map(model => model.id)).toEqual(['claude-page-1', 'claude-page-2'])
    expect(new URL(urls[0]!).searchParams.get('limit')).toBe('1000')
    expect(new URL(urls[1]!).searchParams.get('after_id')).toBe('claude-page-1')
    expect(result.models.find(model => model.id === 'claude-page-2')?.contextLength).toBe(200000)
  })

  test('gemini-api discovers models and filters to generateContent', async () => {
    const result = await listModelsForProviderWithSource('gemini-api', {
      adapters: {
        env: { GEMINI_API_KEY: 'gm' },
        fetch: fetchReturning({
          models: [
            { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
          ],
        }),
      },
    })
    expect(result.source).toBe('live')
    expect(result.models.map(m => m.id)).toEqual(['gemini-3.5-flash']) // embedding filtered out, prefix stripped
  })

  test('gemini-api follows nextPageToken and preserves display/token metadata', async () => {
    const urls: string[] = []
    const result = await listModelsForProviderWithSource('gemini-api', {
      adapters: {
        env: { GEMINI_API_KEY: 'gm' },
        fetch: (async input => {
          const url = String(input)
          urls.push(url)
          const token = new URL(url).searchParams.get('pageToken')
          return new Response(JSON.stringify(token
            ? {
                models: [{
                  name: 'models/gemini-page-2',
                  displayName: 'Gemini Page Two',
                  inputTokenLimit: 1000000,
                  outputTokenLimit: 8192,
                  supportedGenerationMethods: ['generateContent'],
                }],
              }
            : {
                models: [{ name: 'models/gemini-page-1', supportedGenerationMethods: ['generateContent'] }],
                nextPageToken: 'page-2',
              }))
        }) as typeof fetch,
      },
    })
    expect(result.models.map(model => model.id)).toEqual(['gemini-page-1', 'gemini-page-2'])
    expect(new URL(urls[0]!).searchParams.get('pageSize')).toBe('1000')
    expect(new URL(urls[1]!).searchParams.get('pageToken')).toBe('page-2')
    expect(result.models.find(model => model.id === 'gemini-page-2')).toMatchObject({
      displayName: 'gemini-page-2  (Gemini Page Two)',
      contextLength: 1000000,
      outputTokenLimit: 8192,
    })
  })

  test('openrouter discovers models from /api/v1/models', async () => {
    const result = await listModelsForProviderWithSource('openrouter', {
      adapters: {
        env: { OPENROUTER_API_KEY: 'or' },
        fetch: fetchReturning({ data: [{ id: 'anthropic/claude-sonnet-5' }, { id: 'openai/gpt-5.5' }] }),
      },
    })
    expect(result.source).toBe('live')
    expect(result.models.map(m => m.id)).toContain('openai/gpt-5.5')
  })

  test('OpenRouter fresh-only discovery fetches every time and never shows stale fallback', async () => {
    let calls = 0
    const fetchCatalog = (async () => {
      calls++
      return new Response(
        JSON.stringify({ data: [{ id: `vendor/live-model-${calls}` }] }),
      )
    }) as unknown as typeof fetch
    const options = {
      freshOnly: true,
      adapters: {
        env: { OPENROUTER_API_KEY: 'or' },
        fetch: fetchCatalog,
      },
    } as const

    const first = await listModelsForProviderWithSource('openrouter', options)
    const second = await listModelsForProviderWithSource('openrouter', options)
    expect(calls).toBe(2)
    expect(first.models.map(model => model.id)).toEqual(['vendor/live-model-1'])
    expect(second.models.map(model => model.id)).toEqual(['vendor/live-model-2'])

    const failed = await listModelsForProviderWithSource('openrouter', {
      freshOnly: true,
      adapters: {
        env: { OPENROUTER_API_KEY: 'or' },
        fetch: (async () => {
          throw new Error('offline')
        }) as unknown as typeof fetch,
      },
    })
    expect(failed.models).toEqual([])
    expect(failed.source).toBe('live')
    expect(failed.warning).toContain('No cached catalog was shown')
  })

  test('OpenRouter models that explicitly lack tools are described and not selectable', async () => {
    const result = await listModelsForProviderWithSource('openrouter', {
      adapters: {
        env: { OPENROUTER_API_KEY: 'or' },
        fetch: fetchReturning({ data: [
          { id: 'text-only', supported_parameters: ['temperature'] },
          { id: 'tool-model', supported_parameters: ['tools', 'temperature'] },
        ] }),
      },
    })
    const textOnly = result.models.find(model => model.id === 'text-only')!
    expect(textOnly.description).toContain('no tool calling')
    expect(validateProviderModelPair('openrouter', 'text-only', {
      availableModels: result.models,
    }).valid).toBe(false)
    expect(validateProviderModelPair('openrouter', 'tool-model', {
      availableModels: result.models,
    }).valid).toBe(true)
  })

  test('a failed endpoint never receives another endpoint cache entry', async () => {
    const first = await listModelsForProviderWithSource('lmstudio', {
      settings: { provider: { active: 'lmstudio', baseUrl: 'http://host-a:1234/v1' } },
      adapters: { fetch: fetchReturning({ data: [{ id: 'model-from-a' }] }) },
    })
    expect(first.models.map(model => model.id)).toEqual(['model-from-a'])

    const second = await listModelsForProviderWithSource('lmstudio', {
      settings: { provider: { active: 'lmstudio', baseUrl: 'http://host-b:1234/v1' } },
      adapters: {
        fetch: (async () => { throw new Error('host b offline') }) as unknown as typeof fetch,
      },
    })
    expect(second.models.map(model => model.id)).not.toContain('model-from-a')
    expect(second.source).not.toBe('cache')
    expect(second.warning).toContain('host b offline')
  })

  test('not connected -> falls back to curated list, clearly labeled static', async () => {
    const result = await listModelsForProviderWithSource('openai-api', {
      adapters: { env: {} }, // no key, no fetch reached
    })
    expect(result.source).toBe('static')
    expect(result.models.length).toBeGreaterThan(0) // curated fallback so the picker isn't empty
    expect(result.warning ?? '').toContain('ur connect')
  })

  test('HTTP error falls back to curated list with a warning', async () => {
    const result = await listModelsForProviderWithSource('openai-api', {
      adapters: { env: { OPENAI_API_KEY: 'sk-bad' }, fetch: fetchReturning({ error: 'nope' }, 401) },
    })
    expect(result.source).toBe('static')
    expect(result.warning ?? '').toContain('401')
  })
})

describe('OpenAI-compatible reasoning discovery', () => {
  test('preserves provider-authored reasoning metadata from /v1/models', async () => {
    const settings = {
      provider: {
        active: 'llama.cpp' as const,
        baseUrl: 'http://cluster.local:8080/v1',
      },
    }
    const result = await listModelsForProviderWithSource('llama.cpp', {
      settings,
      adapters: {
        fetch: fetchReturning({
          data: [
            {
              id: 'reasoner.gguf',
              reasoning: {
                supported_efforts: ['low', 'high', 'xhigh'],
                default_effort: 'high',
              },
            },
          ],
        }),
      },
    })

    expect(result.models[0]?.reasoning).toEqual({
      supportedEfforts: ['low', 'high', 'xhigh'],
      defaultEffort: 'high',
    })
    expect(
      getProviderReasoningCapabilitiesForModel(
        'reasoner.gguf',
        'llama.cpp',
        settings,
      ),
    ).toEqual({
      supportedEfforts: ['low', 'high', 'xhigh'],
      defaultEffort: 'high',
    })
  })

  test('queries focused llama.cpp models through /props and caches the template capability', async () => {
    const settings = {
      provider: {
        active: 'llama.cpp' as const,
        baseUrl: 'http://cluster.local:8080/v1',
      },
    }
    await listModelsForProviderWithSource('llama.cpp', {
      settings,
      adapters: { fetch: fetchReturning({ data: [{ id: 'cluster-model' }] }) },
    })

    const seen: string[] = []
    const reasoning = await ensureProviderReasoningCapabilitiesForModel(
      'llama.cpp',
      'cluster-model',
      {
        settings,
        adapters: {
          fetch: (async input => {
            seen.push(String(input))
            return new Response(
              JSON.stringify({
                chat_template_caps: { supports_reasoning_effort: true },
              }),
            )
          }) as typeof fetch,
        },
      },
    )

    expect(reasoning).toEqual({ supportedEfforts: null })
    expect(seen).toHaveLength(1)
    const propsUrl = new URL(seen[0]!)
    expect(propsUrl.pathname).toBe('/props')
    expect(propsUrl.searchParams.get('model')).toBe('cluster-model')
    expect(
      getProviderReasoningCapabilitiesForModel(
        'cluster-model',
        'llama.cpp',
        settings,
      ),
    ).toEqual({ supportedEfforts: null })
  })

  test('does not invent graded effort when llama.cpp rejects it', async () => {
    const settings = {
      provider: {
        active: 'llama.cpp' as const,
        baseUrl: 'http://cluster.local:8080/v1',
      },
    }
    await listModelsForProviderWithSource('llama.cpp', {
      settings,
      adapters: { fetch: fetchReturning({ data: [{ id: 'plain-model' }] }) },
    })
    const reasoning = await ensureProviderReasoningCapabilitiesForModel(
      'llama.cpp',
      'plain-model',
      {
        settings,
        adapters: {
          fetch: fetchReturning({
            chat_template_caps: { supports_reasoning_effort: false },
          }),
        },
      },
    )
    expect(reasoning).toEqual({ supportedEfforts: [] })
  })
})

describe('subscription provider visibility', () => {
  test('subscription CLI providers are hidden by default', () => {
    const shown = listProviders().map(p => p.id)
    for (const id of ['codex-cli', 'claude-code-cli', 'gemini-cli', 'antigravity-cli']) {
      expect(shown).not.toContain(id)
    }
    // The internal generic "subscription" placeholder is hidden from listings.
    expect(shown).not.toContain('subscription')
  })

  test('subscription CLIs keep a curated model list (no live enumeration)', async () => {
    const result = await listModelsForProviderWithSource('codex-cli')
    expect(result.source).toBe('static')
    expect(result.models.length).toBeGreaterThan(0)
  })

  test('subscription CLI providers are runnable directly, no opt-in gate (1.30.3 behavior)', () => {
    // First-class: selecting a subscription provider is not blocked; it dispatches
    // via the official CLI (log in with `ur auth <provider>`).
    expect(getProviderRuntimeBlockReason('codex-cli', {}, {} as any)).toBeNull()
    expect(getProviderRuntimeBlockReason('claude-code-cli', {}, {} as any)).toBeNull()
    expect(getProviderRuntimeBlockReason('gemini-cli', {}, {} as any)).toBeNull()
    expect(getProviderRuntimeBlockReason('antigravity-cli', {}, {} as any)).toBeNull()
  })
})
