import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import {
  buildProviderAuthCommand,
  cacheProviderModelsForProvider,
  doctorProvider,
  formatProviderList,
  getActiveProviderSettings,
  getProviderRuntimeInfo,
  listProviders,
  resolveProviderId,
  listModelsForProviderWithSource,
  setProviderModel,
  setSafeProviderConfig,
  type CommandResult,
  type ProviderDoctorAdapters,
} from '../src/services/providers/providerRegistry.js'
import { getInitialSettings, updateSettingsForSource } from '../src/utils/settings/settings.js'

function adapters(options: {
  missing?: string[]
  env?: Record<string, string | undefined>
  run?: (file: string, args: string[]) => Promise<CommandResult>
  fetch?: typeof fetch
} = {}): ProviderDoctorAdapters {
  const missing = new Set(options.missing ?? [])
  return {
    env: options.env ?? {},
    which: async command => (missing.has(command) ? null : `/usr/bin/${command}`),
    run:
      options.run ??
      (async (_file, args) => ({
        stdout: args.includes('--version') ? '1.0.0' : 'Logged in',
        stderr: '',
        code: 0,
      })),
    fetch: options.fetch,
  }
}

describe('provider registry legal access paths', () => {
  test('resolves user-facing provider aliases to canonical IDs', () => {
    expect(resolveProviderId('claude')).toBe('claude-code-cli')
    expect(resolveProviderId('Claude Code')).toBe('claude-code-cli')
    expect(resolveProviderId('chatgpt')).toBe('codex-cli')
    expect(resolveProviderId('codex-cli')).toBe('codex-cli')
    expect(resolveProviderId('agy')).toBe('antigravity-cli')
    expect(resolveProviderId('LM Studio')).toBe('lmstudio')
    expect(resolveProviderId('llama cpp')).toBe('llama.cpp')
    expect(resolveProviderId('not-a-provider')).toBeNull()
  })

  test('provider list shows canonical IDs and aliases', () => {
    const text = formatProviderList()

    expect(text).toContain('ID')
    expect(text).toContain('Access type')
    expect(text).toContain('Credential')
    expect(text).toContain('claude-code-cli')
    expect(text).toContain('claude')
    expect(text).toContain('antigravity-cli')
    expect(text).toContain('agy')
  })

  test('/model provider entries show access type and credential type', () => {
    const providers = listProviders()
    const codex = providers.find(provider => provider.id === 'codex-cli')
    const openai = providers.find(provider => provider.id === 'openai-api')
    const ollama = providers.find(provider => provider.id === 'ollama')
    const lmstudio = providers.find(provider => provider.id === 'lmstudio')

    expect(codex?.accessType).toBe('subscription')
    expect(codex?.credentialType).toBe('cli-login')
    expect(openai?.accessType).toBe('api')
    expect(openai?.credentialType).toBe('api-key')
    expect(ollama?.accessType).toBe('local')
    expect(ollama?.credentialType).toBe('local-runtime')
    expect(lmstudio?.accessType).toBe('server')
    expect(lmstudio?.credentialType).toBe('openai-compatible-endpoint')
  })

  test('API and subscription providers are visually distinct', () => {
    const text = formatProviderList()

    expect(text).toContain('Codex CLI | codex-cli')
    expect(text).toContain('subscription')
    expect(text).toContain('cli-login')
    expect(text).toContain('OpenAI API | openai-api')
    expect(text).toContain('api-key')
  })

  test('reports Codex CLI missing', async () => {
    const result = await doctorProvider('codex-cli', {
      adapters: adapters({ missing: ['codex'] }),
      settings: {},
    })

    expect(result.ok).toBe(false)
    expect(result.failureReason).toBe('CLI missing')
    expect(result.suggestedFix).toContain('ur auth chatgpt')
  })

  test('reports Codex not logged in', async () => {
    const result = await doctorProvider('codex-cli', {
      adapters: adapters({
        run: async (_file, args) =>
          args[0] === 'login'
            ? {
                stdout: '',
                stderr: 'Not logged in',
                code: 1,
              }
            : {
                stdout: 'codex-cli 1.0.0',
                stderr: '',
                code: 0,
              },
      }),
      settings: {},
    })

    expect(result.ok).toBe(false)
    expect(result.failureReason).toBe('not logged in')
  })

  test('reports Codex logged in', async () => {
    const result = await doctorProvider('codex-cli', {
      adapters: adapters({
        run: async (_file, args) =>
          args[0] === 'login'
            ? {
                stdout: 'Logged in using ChatGPT',
                stderr: '',
                code: 0,
              }
            : {
                stdout: 'codex-cli 1.0.0',
                stderr: '',
                code: 0,
              },
      }),
      settings: {},
    })

    expect(result.ok).toBe(true)
  })

  test('reports Claude CLI missing and exposes subscription login command', async () => {
    const result = await doctorProvider('claude-code-cli', {
      adapters: adapters({ missing: ['claude'] }),
      settings: {},
    })
    const auth = buildProviderAuthCommand('claude-code-cli')

    expect(result.ok).toBe(false)
    expect(result.failureReason).toBe('CLI missing')
    expect(auth?.command).toBe('claude')
    expect(auth?.args).toEqual(['auth', 'login'])
  })

  test('warns when ANTHROPIC_API_KEY may override Claude subscription auth', async () => {
    const result = await doctorProvider('claude-code-cli', {
      adapters: adapters({
        env: { ANTHROPIC_API_KEY: 'set' },
        run: async (_file, args) =>
          args[0] === 'auth'
            ? { stdout: 'authenticated', stderr: '', code: 0 }
            : { stdout: '2.0.0', stderr: '', code: 0 },
      }),
      settings: {},
    })

    expect(result.checks.some(check => check.name === 'api_key_override')).toBe(true)
  })

  test('reports Gemini CLI missing', async () => {
    const result = await doctorProvider('gemini-cli', {
      adapters: adapters({ missing: ['gemini'] }),
      settings: {},
    })

    expect(result.ok).toBe(false)
    expect(result.failureReason).toBe('CLI missing')
  })

  test('accepts Gemini enterprise-supported CLI output', async () => {
    const result = await doctorProvider('gemini-cli', {
      adapters: adapters({
        run: async () => ({
          stdout: 'Gemini Code Assist Enterprise 1.0.0',
          stderr: '',
          code: 0,
        }),
      }),
      settings: {},
    })

    expect(result.ok).toBe(true)
    expect(result.checks.some(check => check.name === 'account_type' && check.status === 'pass')).toBe(true)
  })

  test('blocks Gemini personal unsupported path', async () => {
    const result = await doctorProvider('gemini-cli', {
      adapters: adapters({
        run: async () => ({
          stdout: 'personal account unsupported',
          stderr: '',
          code: 0,
        }),
      }),
      settings: {},
    })

    expect(result.ok).toBe(false)
    expect(result.failureReason).toBe('unsupported account type')
  })

  test('reports Antigravity CLI missing', async () => {
    const result = await doctorProvider('antigravity-cli', {
      adapters: adapters({ missing: ['agy', 'antigravity', 'google-antigravity', 'ag'] }),
      settings: {},
    })

    expect(result.ok).toBe(false)
    expect(result.failureReason).toBe('CLI missing')
  })

  test('detects the official agy Antigravity CLI command', async () => {
    const result = await doctorProvider('antigravity-cli', {
      adapters: adapters({ missing: ['antigravity', 'google-antigravity', 'ag'] }),
      settings: {},
    })
    const auth = buildProviderAuthCommand('antigravity-cli')

    expect(result.ok).toBe(true)
    expect(result.checks.find(check => check.name === 'cli')?.message).toContain('/usr/bin/agy')
    expect(auth?.command).toBe('agy')
  })


  test('reports Ollama unavailable and available', async () => {
    const unavailable = await doctorProvider('ollama', {
      adapters: adapters({
        fetch: async () => {
          throw new Error('connection refused')
        },
      }),
      settings: {},
    })
    const available = await doctorProvider('ollama', {
      adapters: adapters({
        fetch: async () => new Response('{"models":[{"name":"llama3"}]}'),
      }),
      settings: { provider: { active: 'ollama', model: 'llama3' } },
    })

    expect(unavailable.ok).toBe(false)
    expect(available.ok).toBe(true)
  })

  test('reports OpenAI-compatible endpoint unavailable', async () => {
    const result = await doctorProvider('openai-compatible', {
      adapters: adapters({
        fetch: async () => new Response('unavailable', { status: 503 }),
      }),
      settings: {
        provider: {
          active: 'openai-compatible',
          baseUrl: 'http://localhost:9999/v1',
        },
      },
    })

    expect(result.ok).toBe(false)
    expect(result.failureReason).toContain('HTTP 503')
  })

  test('reports missing API keys only for API providers', async () => {
    const result = await doctorProvider('openai-api', {
      adapters: adapters({ env: {} }),
      settings: {},
    })

    expect(result.ok).toBe(false)
    expect(result.failureReason).toBe('API key missing')
  })

  test('reports fallback disabled and enabled without silently switching', async () => {
    const disabled = await doctorProvider('codex-cli', {
      adapters: adapters({ missing: ['codex'] }),
      settings: { provider: { active: 'codex-cli', fallback: 'disabled' } },
    })
    const enabled = await doctorProvider('codex-cli', {
      adapters: adapters({ missing: ['codex'] }),
      settings: { provider: { active: 'codex-cli', fallback: 'ollama' } },
    })

    expect(disabled.fallback?.enabled).toBe(false)
    expect(enabled.fallback?.enabled).toBe(true)
    expect(enabled.fallback?.message).toContain('will ask before using it')
  })

  test('status bar runtime info includes provider auth display', () => {
    const info = getProviderRuntimeInfo({
      provider: {
        active: 'openrouter',
        model: 'openai/gpt-4.1',
      },
    })

    expect(info.providerLabel).toBe('OpenRouter')
    expect(info.accessType).toBe('api')
    expect(info.credentialType).toBe('api-key')
    expect(info.authLabel).toBe('API')
    expect(info.model).toBe('openai/gpt-4.1')
  })

  test('provider registry does not read hidden credential files', () => {
    const source = readFileSync('src/services/providers/providerRegistry.ts', 'utf8')

    expect(source).not.toContain('.codex')
    expect(source).not.toContain('.claude')
    expect(source).not.toContain('refresh_token')
    expect(source).not.toContain('browser cookie')
    expect(source).not.toContain('readFile')
  })
})

describe('provider-scoped model listing', () => {
  const {
    listModelsForProvider,
    isModelSupportedByProvider,
    getDefaultModelForProvider,
    getValidModelIdsForProvider,
    validateProviderModelCompatibility,
  } = require('../src/services/providers/providerRegistry.js')

  test('listModelsForProvider returns models only for specified provider', () => {
    const openaiModels = listModelsForProvider('openai-api')
    const anthropicModels = listModelsForProvider('anthropic-api')
    const ollamaModels = listModelsForProvider('ollama')

    // OpenAI models
    expect(openaiModels.some(m => m.id === 'gpt-4o')).toBe(true)
    expect(openaiModels.some(m => m.id === 'gpt-4o-mini')).toBe(true)
    expect(openaiModels.some(m => m.id === 'o1')).toBe(true)
    // OpenAI should NOT have Claude models
    expect(openaiModels.some(m => m.id.includes('claude'))).toBe(false)

    // Anthropic models
    expect(anthropicModels.some(m => m.id.includes('claude'))).toBe(true)
    // Anthropic should NOT have GPT models
    expect(anthropicModels.some(m => m.id.includes('gpt-'))).toBe(false)

    // Ollama uses dynamic discovery
    expect(ollamaModels.some(m => m.isDynamic)).toBe(true)
    expect(ollamaModels.some(m => m.id.includes('gpt-'))).toBe(false)
    expect(ollamaModels.some(m => m.id.includes('claude'))).toBe(false)
  })

  test('isModelSupportedByProvider returns true only for provider models', () => {
    // OpenAI provider supports GPT models
    expect(isModelSupportedByProvider('openai-api', 'gpt-5.5')).toBe(true)
    expect(isModelSupportedByProvider('openai-api', 'gpt-4o')).toBe(true)
    expect(isModelSupportedByProvider('openai-api', 'o1')).toBe(true)
    // OpenAI provider does NOT support Claude models
    expect(isModelSupportedByProvider('openai-api', 'claude-sonnet-5')).toBe(false)

    // Anthropic provider supports Claude models
    expect(isModelSupportedByProvider('anthropic-api', 'claude-sonnet-5')).toBe(true)
    expect(isModelSupportedByProvider('anthropic-api', 'claude-opus-4-8')).toBe(true)
    // Anthropic provider does NOT support GPT models
    expect(isModelSupportedByProvider('anthropic-api', 'gpt-5.5')).toBe(false)

    // Dynamic providers require live/cached scoped discovery.
    expect(isModelSupportedByProvider('ollama', 'llama3')).toBe(false)
    cacheProviderModelsForProvider('ollama', ['llama3', 'qwen3-coder'])
    cacheProviderModelsForProvider('lmstudio', ['custom-model'])
    expect(isModelSupportedByProvider('ollama', 'llama3')).toBe(true)
    expect(isModelSupportedByProvider('ollama', 'qwen3-coder')).toBe(true)
    expect(isModelSupportedByProvider('lmstudio', 'custom-model')).toBe(true)
  })

  test('getDefaultModelForProvider returns provider default', () => {
    const openaiDefault = getDefaultModelForProvider('openai-api')
    const anthropicDefault = getDefaultModelForProvider('anthropic-api')
    const geminiDefault = getDefaultModelForProvider('gemini-api')

    expect(openaiDefault).toBe('gpt-5.5')
    expect(anthropicDefault).toBe('claude-sonnet-5')
    expect(geminiDefault).toBe('gemini-3.5-flash')
  })

  test('getValidModelIdsForProvider returns only non-dynamic model IDs', () => {
    cacheProviderModelsForProvider('ollama', ['llama3', 'qwen3-coder'])
    const openaiModels = getValidModelIdsForProvider('openai-api')
    const ollamaModels = getValidModelIdsForProvider('ollama')

    expect(openaiModels).toContain('gpt-5.5')
    expect(openaiModels).toContain('gpt-4o')
    expect(openaiModels).not.toContain('dynamic')

    expect(ollamaModels).toEqual(['llama3', 'qwen3-coder'])
  })

  test('validateProviderModelCompatibility returns valid for compatible pairs', () => {
    const result1 = validateProviderModelCompatibility('openai-api', 'gpt-5.5')
    const result2 = validateProviderModelCompatibility('anthropic-api', 'claude-sonnet-5')
    cacheProviderModelsForProvider('ollama', ['llama3'])
    const result3 = validateProviderModelCompatibility('ollama', 'llama3')

    expect(result1.valid).toBe(true)
    expect(result2.valid).toBe(true)
    expect(result3.valid).toBe(true)
  })

  test('validateProviderModelCompatibility returns error for incompatible pairs', () => {
    const result = validateProviderModelCompatibility('openai-api', 'claude-sonnet-5')

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error).toContain('not available for provider')
      expect(result.error).toContain('openai-api')
      expect(result.validModels).toContain('gpt-5.5')
      expect(result.suggestedModel).toBe('gpt-5.5')
    }
  })

  test('validateProviderModelCompatibility rejects uncached dynamic providers', () => {
    const result = validateProviderModelCompatibility('ollama', 'any-custom-model')

    expect(result.valid).toBe(false)
  })

  test('validateProviderModelCompatibility handles unknown provider', () => {
    const result = validateProviderModelCompatibility('unknown-provider', 'some-model')

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error).toContain('Unknown provider')
      expect(result.validModels).toEqual([])
    }
  })

  test('setSafeProviderConfig clears incompatible model on provider change', () => {
    // Simulate: user has claude-model selected, switches to openai provider
    const validation = validateProviderModelCompatibility('openai-api', 'claude-sonnet-4-20250514')

    expect(validation.valid).toBe(false)
    if (!validation.valid) {
      expect(validation.error).toContain('not available')
      expect(validation.validModels.length).toBeGreaterThan(0)
      expect(validation.suggestedModel).toBeDefined()
    }
  })

  test('empty model list gives clear error for providers without models', () => {
    const models = listModelsForProvider('unknown-provider' as any)
    expect(models).toEqual([])

    const validation = validateProviderModelCompatibility('unknown-provider' as any, 'model')
    expect(validation.valid).toBe(false)
    if (!validation.valid) {
      expect(validation.error).toContain('Unknown provider')
    }
  })

  test('/model shows providers before models using provider metadata', () => {
    const providers = listProviders()
    const firstProvider = providers[0]
    const firstProviderModels = listModelsForProvider(firstProvider.id)

    expect(firstProvider).toHaveProperty('accessType')
    expect(firstProvider).toHaveProperty('credentialType')
    expect(firstProviderModels.length).toBeGreaterThan(0)
  })

  test('selecting provider A shows only provider A models', async () => {
    const result = await listModelsForProviderWithSource('openai-api')
    const ids = result.models.map(model => model.id)

    expect(result.source).toBe('static')
    expect(ids).toContain('gpt-5.5')
    expect(ids.some(id => id.startsWith('claude-code/'))).toBe(false)
    expect(ids.some(id => id.startsWith('gemini-cli/'))).toBe(false)
  })

  test('selecting provider B shows only provider B models', async () => {
    const result = await listModelsForProviderWithSource('anthropic-api')
    const ids = result.models.map(model => model.id)

    expect(result.source).toBe('static')
    expect(ids).toContain('claude-sonnet-5')
    expect(ids.some(id => id.startsWith('codex/'))).toBe(false)
    expect(ids.some(id => id.startsWith('gemini-cli/'))).toBe(false)
  })

  test('OpenAI API models do not appear under Codex CLI and vice versa', () => {
    const codexModels = listModelsForProvider('codex-cli').map(model => model.id)
    const openaiModels = listModelsForProvider('openai-api').map(model => model.id)
    const intersection = codexModels.filter(model => openaiModels.includes(model))

    expect(intersection).toEqual([])
    expect(codexModels.every(model => model.startsWith('codex/'))).toBe(true)
    expect(openaiModels.every(model => !model.startsWith('codex/'))).toBe(true)
  })

  test('Claude API and Claude Code are separated', () => {
    const claudeCodeModels = listModelsForProvider('claude-code-cli').map(model => model.id)
    const claudeApiModels = listModelsForProvider('anthropic-api').map(model => model.id)

    expect(claudeCodeModels.filter(model => claudeApiModels.includes(model))).toEqual([])
    expect(claudeCodeModels.every(model => model.startsWith('claude-code/'))).toBe(true)
    expect(claudeApiModels.every(model => !model.startsWith('claude-code/'))).toBe(true)
  })

  test('Gemini API and Gemini CLI are separated', () => {
    const geminiCliModels = listModelsForProvider('gemini-cli').map(model => model.id)
    const geminiApiModels = listModelsForProvider('gemini-api').map(model => model.id)

    expect(geminiCliModels.filter(model => geminiApiModels.includes(model))).toEqual([])
    expect(geminiCliModels.every(model => model.startsWith('gemini-cli/'))).toBe(true)
    expect(geminiApiModels.every(model => !model.startsWith('gemini-cli/'))).toBe(true)
  })

  test('local providers do not leak cloud/API models', async () => {
    const result = await listModelsForProviderWithSource('lmstudio', {
      settings: { provider: { active: 'lmstudio', baseUrl: 'http://localhost:1234/v1' } },
      adapters: adapters({
        fetch: async () => new Response(JSON.stringify({ data: [{ id: 'local-coder' }] })),
      }),
    })
    const ids = result.models.map(model => model.id)

    expect(result.source).toBe('live')
    expect(ids).toEqual(['local-coder'])
    expect(ids.some(id => id.includes('gpt-') || id.includes('claude') || id.includes('gemini-'))).toBe(false)
  })

  test('invalid provider/model pair is rejected with scoped error', () => {
    const validation = validateProviderModelCompatibility('codex-cli', 'gpt-5.5')

    expect(validation.valid).toBe(false)
    if (!validation.valid) {
      expect(validation.error).toContain('provider "codex-cli"')
      expect(validation.error).toContain('Run /model')
      expect(validation.validModels).toContain('codex/gpt-5.5')
    }
  })

  test('changing provider invalidates incompatible model', () => {
    updateSettingsForSource('userSettings', {
      provider: { active: 'openai-api', model: 'gpt-5.5' },
      model: 'gpt-5.5',
    })

    const result = setSafeProviderConfig('provider', 'anthropic-api')
    const settings = getActiveProviderSettings(getInitialSettings())

    expect(result.ok).toBe(true)
    expect(result.message).toContain('Cleared incompatible model')
    expect(settings.active).toBe('anthropic-api')
    expect(settings.model).toBeUndefined()
  })

  test('live discovery failure falls back only to same-provider cached models', async () => {
    cacheProviderModelsForProvider('lmstudio', ['lmstudio-local'])
    const result = await listModelsForProviderWithSource('lmstudio', {
      settings: { provider: { active: 'lmstudio', baseUrl: 'http://localhost:1234/v1' } },
      adapters: adapters({
        fetch: async () => {
          throw new Error('connection refused')
        },
      }),
    })
    const ids = result.models.map(model => model.id)

    expect(result.source).toBe('cache')
    expect(ids).toEqual(['lmstudio-local'])
    expect(ids).not.toContain('gpt-5.5')
    expect(result.warning).toContain('lmstudio')
  })

  test('empty live model list shows clear scoped error', async () => {
    const result = await listModelsForProviderWithSource('vllm', {
      settings: { provider: { active: 'vllm', baseUrl: 'http://localhost:8000/v1' } },
      adapters: adapters({
        fetch: async () => new Response(JSON.stringify({ data: [] })),
      }),
    })

    expect(result.models).toEqual([])
    expect(result.warning).toContain('vllm')
    expect(result.warning).toContain('returned no models')
  })

  test('saved config preserves valid provider/model pair', () => {
    const result = setProviderModel('openai-api', 'gpt-5.5')
    const settings = getActiveProviderSettings(getInitialSettings())

    expect(result.ok).toBe(true)
    expect(settings.active).toBe('openai-api')
    expect(settings.model).toBe('gpt-5.5')
  })
})
