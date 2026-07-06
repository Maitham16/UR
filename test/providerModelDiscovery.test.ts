import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  clearProviderModelCacheForTests,
  getProviderRuntimeBlockReason,
  listModelsForProviderWithSource,
  listProviders,
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
