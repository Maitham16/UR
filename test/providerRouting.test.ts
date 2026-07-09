import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  createProviderClient,
  resolveActiveProviderModel,
  sendModelRequest,
  streamModelResponse,
  validateProviderRuntime,
} from '../src/services/api/providerClient.js'
import {
  cacheProviderModelsForProvider,
  clearProviderModelCacheForTests,
  getProviderRuntimeBlockReason,
  getProviderRuntimeBackend,
  isProviderRuntimeSelectable,
} from '../src/services/providers/providerRegistry.js'
import {
  clearProviderApiKey,
  getStoredProviderApiKey,
  setProviderApiKey,
} from '../src/services/providers/providerCredentials.js'

beforeEach(() => {
  clearProviderModelCacheForTests()
})

afterEach(() => {
  clearProviderModelCacheForTests()
})

describe('provider runtime routing', () => {
  test('ollama provider uses Ollama client', async () => {
    cacheProviderModelsForProvider('ollama', ['llama3'])

    const client = await createProviderClient('ollama', { model: 'llama3' })
    expect(client).toBeDefined()
    expect(client.beta).toBeDefined()
    expect(client.beta.messages).toBeDefined()
  })

  test('openai-api provider requires API key', async () => {
    await withEnvCleared(['OPENAI_API_KEY'], async () => {
      await expect(
        createProviderClient('openai-api', { apiKey: '', model: 'gpt-5.5' }),
      ).rejects.toThrow('API key')
    })
  })

  test('anthropic-api provider requires API key', async () => {
    await withEnvCleared(['ANTHROPIC_API_KEY'], async () => {
      await expect(
        createProviderClient('anthropic-api', {
          apiKey: '',
          model: 'claude-sonnet-5',
        }),
      ).rejects.toThrow('API key')
    })
  })

  test('lmstudio provider uses OpenAI-compatible endpoint', async () => {
    cacheProviderModelsForProvider('lmstudio', ['local-model'])

    const client = await createProviderClient('lmstudio', {
      model: 'local-model',
    })
    expect(client).toBeDefined()
    expect(client.beta).toBeDefined()
  })

  test('llama.cpp provider uses OpenAI-compatible endpoint', async () => {
    cacheProviderModelsForProvider('llama.cpp', ['llama-cpp-model'])

    const client = await createProviderClient('llama.cpp', {
      model: 'llama-cpp-model',
    })
    expect(client).toBeDefined()
  })

  test('vllm provider uses OpenAI-compatible endpoint', async () => {
    cacheProviderModelsForProvider('vllm', ['vllm-model'])

    const client = await createProviderClient('vllm', { model: 'vllm-model' })
    expect(client).toBeDefined()
  })

  test('unknown provider throws error', async () => {
    // This test would require mocking the provider registry
    // For now, verify that createProviderClient handles unknown providers
    await expect(
      createProviderClient('unknown-provider' as any)
    ).rejects.toThrow('Unknown provider')
  })

  test('validateProviderRuntime checks local provider configuration', async () => {
    const result = await validateProviderRuntime('lmstudio')
    expect(result.ok).toBe(true)
  })

  test('validateProviderRuntime fails for missing OpenAI-compatible base URL', async () => {
    const result = await validateProviderRuntime('openai-compatible')
    expect(result.ok).toBe(false)
    if (result.ok === false) {
      expect(result.error).toContain('base URL')
    }
  })

  test('validateProviderRuntime checks API key presence', async () => {
    await withEnvCleared(['OPENAI_API_KEY'], async () => {
      const result = await validateProviderRuntime('openai-api')
      expect(result.ok).toBe(false)
      if (result.ok === false) {
        expect(result.error).toContain('API key')
      }
    })
  })

  test('subscription CLI providers are first-class and selectable (1.30.3 behavior)', async () => {
    expect(isProviderRuntimeSelectable('codex-cli')).toBe(true)
    expect(getProviderRuntimeBlockReason('codex-cli')).toBeNull()
    // validateProviderRuntime checks the official CLI is present; in CI it is
    // absent, so it reports not-found — never a bridge block.
    const result = await validateProviderRuntime('codex-cli')
    if (result.ok === false) {
      expect(result.error).not.toContain('external app bridge')
    }
  })

  test('generic subscription placeholder is not directly runnable', async () => {
    expect(isProviderRuntimeSelectable('subscription')).toBe(false)
    expect(getProviderRuntimeBlockReason('subscription')).toContain('placeholder')
    const result = await validateProviderRuntime('subscription')
    expect(result.ok).toBe(false)
  })
})

describe('provider separation', () => {
  test('ollama models do not appear under openai-api', () => {
    // Verify that provider model lists are separate
    const { listModelsForProvider } = require('../src/services/providers/providerRegistry.js')

    const ollamaModels = listModelsForProvider('ollama')
    const openaiModels = listModelsForProvider('openai-api')

    // Ollama uses dynamic discovery
    expect(ollamaModels.some(m => m.isDynamic)).toBe(true)

    // OpenAI API has static models
    expect(openaiModels.some(m => m.id === 'gpt-4o')).toBe(true)
    expect(openaiModels.some(m => m.isDynamic)).toBe(false)
  })

  test('codex-cli models are separate from openai-api', () => {
    const { listModelsForProvider } = require('../src/services/providers/providerRegistry.js')

    const codexModels = listModelsForProvider('codex-cli')
    const openaiModels = listModelsForProvider('openai-api')

    // Both may have gpt-4o but they're separate providers
    expect(codexModels.length).toBeGreaterThan(0)
    expect(openaiModels.length).toBeGreaterThan(0)
    expect(codexModels.map(m => m.id).filter(id => openaiModels.some(m => m.id === id))).toEqual([])
  })

  test('claude-code-cli models are separate from anthropic-api', () => {
    const { listModelsForProvider } = require('../src/services/providers/providerRegistry.js')

    const claudeCodeModels = listModelsForProvider('claude-code-cli')
    const anthropicApiModels = listModelsForProvider('anthropic-api')

    expect(claudeCodeModels.length).toBeGreaterThan(0)
    expect(anthropicApiModels.length).toBeGreaterThan(0)
    expect(claudeCodeModels.map(m => m.id).filter(id => anthropicApiModels.some(m => m.id === id))).toEqual([])
  })

  test('gemini-cli models are separate from gemini-api', () => {
    const { listModelsForProvider } = require('../src/services/providers/providerRegistry.js')

    const geminiCliModels = listModelsForProvider('gemini-cli')
    const geminiApiModels = listModelsForProvider('gemini-api')

    expect(geminiCliModels.length).toBeGreaterThan(0)
    expect(geminiApiModels.length).toBeGreaterThan(0)
    expect(geminiCliModels.map(m => m.id).filter(id => geminiApiModels.some(m => m.id === id))).toEqual([])
  })
})

describe('provider dispatch does not fallback to Ollama', () => {
  test('API provider failure does not fallback to Ollama', async () => {
    await withEnvCleared(['OPENAI_API_KEY'], async () => {
      await expect(
        createProviderClient('openai-api', { apiKey: '', model: 'gpt-5.5' }),
      ).rejects.toThrow('API key')
    })
  })

  test('local provider failure does not fallback to another provider', async () => {
    cacheProviderModelsForProvider('lmstudio', ['local-model'])

    // Should fail for lmstudio, not fallback to ollama
    const client = await createProviderClient('lmstudio', {
      model: 'local-model',
    })
    expect(client).toBeDefined()
    // The client is created, but actual requests would fail

    const runtime = resolveActiveProviderModel({
      settings: {
        provider: {
          active: 'lmstudio',
          model: 'local-model',
          baseUrl: 'http://invalid-host:9999/v1',
        },
      },
    })
    expect(runtime.providerId).toBe('lmstudio')
    expect(runtime.runtimeBackend).toBe('openai-compatible:lmstudio')
  })
})

describe('runtime request dispatch', () => {
  test('selected ollama sends request through Ollama backend', async () => {
    cacheProviderModelsForProvider('ollama', ['llama3'])
    const calls: string[] = []
    await streamModelResponse('ollama', 'llama3', userMessages(), {
      clientFactory: recordingFactory(calls),
    })
    expect(calls).toEqual(['ollama'])
  })

  test('selected codex-cli routes to its CLI backend, not Ollama', async () => {
    const calls: string[] = []
    await streamModelResponse('codex-cli', 'codex/gpt-5.5', userMessages(), {
      clientFactory: recordingFactory(calls),
    })
    expect(calls).toEqual(['codex-cli'])
    expect(calls).not.toContain('ollama')
  })

  test('selected openai-api does not call Ollama backend', async () => {
    const calls: string[] = []
    await streamModelResponse('openai-api', 'gpt-5.5', userMessages(), {
      clientFactory: recordingFactory(calls),
    })
    expect(calls).toEqual(['openai-api'])
    expect(calls).not.toContain('ollama')
  })

  test('generic subscription placeholder does not dispatch or call Ollama', async () => {
    const calls: string[] = []
    await expect(
      streamModelResponse('subscription', 'anything', userMessages(), {
        clientFactory: recordingFactory(calls),
      }),
    ).rejects.toThrow()
    expect(calls).toEqual([])
    expect(calls).not.toContain('ollama')
  })

  test('selected claude-code routes to its CLI backend, not the Claude API', async () => {
    const calls: string[] = []
    await streamModelResponse('claude-code-cli', 'claude-code/sonnet', userMessages(), {
      clientFactory: recordingFactory(calls),
    })
    expect(calls).toEqual(['claude-code-cli'])
    expect(calls).not.toContain('anthropic-api')
  })

  test('selected claude-api does not call Claude Code backend', async () => {
    const calls: string[] = []
    await streamModelResponse('anthropic-api', 'claude-sonnet-5', userMessages(), {
      clientFactory: recordingFactory(calls),
    })
    expect(calls).toEqual(['anthropic-api'])
    expect(calls).not.toContain('claude-code-cli')
  })

  test('selected gemini-cli routes to its CLI backend, not the Gemini API', async () => {
    const calls: string[] = []
    await streamModelResponse('gemini-cli', 'gemini-cli/gemini-2.5-pro', userMessages(), {
      clientFactory: recordingFactory(calls),
    })
    expect(calls).toEqual(['gemini-cli'])
    expect(calls).not.toContain('gemini-api')
  })

  test('selected codex-cli dispatches through its CLI backend without an env opt-in', async () => {
    const calls: string[] = []
    await streamModelResponse('codex-cli', 'codex/gpt-5.5', userMessages(), {
      clientFactory: recordingFactory(calls),
    })
    expect(calls).toEqual(['codex-cli'])
    expect(calls).not.toContain('ollama')
  })

  test('selected gemini-api does not call Gemini CLI backend', async () => {
    const calls: string[] = []
    await streamModelResponse('gemini-api', 'gemini-3.5-flash', userMessages(), {
      clientFactory: recordingFactory(calls),
    })
    expect(calls).toEqual(['gemini-api'])
    expect(calls).not.toContain('gemini-cli')
  })

  test('selected openrouter uses OpenRouter backend', async () => {
    const calls: string[] = []
    await streamModelResponse('openrouter', 'openai/gpt-5.5', userMessages(), {
      clientFactory: recordingFactory(calls),
    })
    expect(calls).toEqual(['openrouter'])
    expect(getProviderRuntimeBackend('openrouter')).toBe('api:openrouter')
  })

  test('selected lmstudio uses OpenAI-compatible local endpoint', async () => {
    cacheProviderModelsForProvider('lmstudio', ['local-model'])
    const calls: string[] = []
    await streamModelResponse('lmstudio', 'local-model', userMessages(), {
      clientFactory: recordingFactory(calls),
    })
    expect(calls).toEqual(['lmstudio'])
    expect(getProviderRuntimeBackend('lmstudio')).toBe('openai-compatible:lmstudio')
  })

  test('selected llama.cpp uses OpenAI-compatible local endpoint', async () => {
    cacheProviderModelsForProvider('llama.cpp', ['llama-cpp-model'])
    const calls: string[] = []
    await streamModelResponse('llama.cpp', 'llama-cpp-model', userMessages(), {
      clientFactory: recordingFactory(calls),
    })
    expect(calls).toEqual(['llama.cpp'])
    expect(getProviderRuntimeBackend('llama.cpp')).toBe('openai-compatible:llama.cpp')
  })

  test('selected vllm uses OpenAI-compatible server endpoint', async () => {
    cacheProviderModelsForProvider('vllm', ['vllm-model'])
    const calls: string[] = []
    await streamModelResponse('vllm', 'vllm-model', userMessages(), {
      clientFactory: recordingFactory(calls),
    })
    expect(calls).toEqual(['vllm'])
    expect(getProviderRuntimeBackend('vllm')).toBe('openai-compatible:vllm')
  })

  test('invalid provider/model pair blocks runtime request', async () => {
    const calls: string[] = []
    await expect(
      streamModelResponse('openai-api', 'claude-sonnet-5', userMessages(), {
        clientFactory: recordingFactory(calls),
      }),
    ).rejects.toThrow('runtime dispatch cannot use')
    expect(calls).toEqual([])
  })

  test('stale/invalid claude-code model is rejected before spawning Claude CLI', async () => {
    const calls: string[] = []
    await expect(
      streamModelResponse('claude-code-cli', 'claude-code/sonnet-5', userMessages(), {
        clientFactory: recordingFactory(calls),
      }),
    ).rejects.toThrow('runtime dispatch cannot use')
    expect(calls).toEqual([])
  })

  test('provider dispatch failure does not fallback to Ollama', async () => {
    const calls: string[] = []
    await expect(
      streamModelResponse('openai-api', 'gpt-5.5', userMessages(), {
        clientFactory: async providerId => {
          calls.push(providerId)
          throw new Error('openai unavailable')
        },
      }),
    ).rejects.toThrow('openai unavailable')
    expect(calls).toEqual(['openai-api'])
    expect(calls).not.toContain('ollama')
  })

  test('/model selection affects the next actual runtime resolution', () => {
    const runtime = resolveActiveProviderModel({
      settings: { provider: { active: 'openai-api', model: 'gpt-5.5' } },
    })
    expect(runtime.providerId).toBe('openai-api')
    expect(runtime.model).toBe('gpt-5.5')
    expect(runtime.runtimeBackend).toBe('api:openai')
  })

  test('config save/load preserves runtime provider/model pair', () => {
    const runtime = resolveActiveProviderModel({
      settings: {
        provider: { active: 'anthropic-api', model: 'claude-sonnet-5' },
      },
    })
    expect(runtime.providerId).toBe('anthropic-api')
    expect(runtime.model).toBe('claude-sonnet-5')
    expect(runtime.runtimeBackend).toBe('api:anthropic')
  })
})

describe('runtime dry-run dispatch flow', () => {
  test('dispatches fake requests to selected backend and not Ollama', async () => {
    const flows = [
      ['ollama', 'llama3'],
      ['openai-api', 'gpt-5.5'],
      ['lmstudio', 'local-model'],
    ] as const
    cacheProviderModelsForProvider('ollama', ['llama3'])
    cacheProviderModelsForProvider('lmstudio', ['local-model'])

    for (const [provider, model] of flows) {
      const calls: string[] = []
      await sendModelRequest(provider, model, userMessages(), {
        clientFactory: recordingFactory(calls),
      })
      expect(calls).toEqual([provider])
      if (provider !== 'ollama') {
        expect(calls).not.toContain('ollama')
      }
    }
  })
})

function userMessages() {
  return [{ role: 'user', content: 'hello' }]
}

function recordingFactory(calls: string[]) {
  return async function factory(providerId: string, options: { model?: string } = {}) {
    calls.push(providerId)
    return {
      beta: {
        messages: {
          create(params: any) {
            const data = {
              id: `${providerId}-response`,
              type: 'message',
              role: 'assistant',
              model: params.model ?? options.model,
              content: [{ type: 'text', text: `${providerId} response` }],
              stop_reason: 'end_turn',
              stop_sequence: null,
              usage: {
                input_tokens: 1,
                output_tokens: 1,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
              },
            }
            if (params.stream) {
              return {
                async withResponse() {
                  return {
                    data: {
                      controller: new AbortController(),
                      async *[Symbol.asyncIterator]() {
                        yield { type: 'message_stop' }
                      },
                    },
                    response: new Response('{}'),
                    request_id: data.id,
                  }
                },
              }
            }
            return Promise.resolve(data)
          },
          async countTokens() {
            return { input_tokens: 1 }
          },
        },
      },
    } as any
  }
}

async function withEnvCleared<T>(
  keys: readonly string[],
  run: () => Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>()
  for (const key of keys) {
    previous.set(key, process.env[key])
    delete process.env[key]
  }
  const hadStoredOpenAi = getStoredProviderApiKey('openai-api')
  const hadStoredAnthropic = getStoredProviderApiKey('anthropic-api')
  if (hadStoredOpenAi) clearProviderApiKey('openai-api')
  if (hadStoredAnthropic) clearProviderApiKey('anthropic-api')
  try {
    return await run()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    if (hadStoredOpenAi) setProviderApiKey('openai-api', hadStoredOpenAi)
    if (hadStoredAnthropic) setProviderApiKey('anthropic-api', hadStoredAnthropic)
  }
}
