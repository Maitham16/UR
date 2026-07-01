import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import {
  buildProviderAuthCommand,
  doctorProvider,
  formatProviderList,
  getProviderRuntimeInfo,
  resolveProviderId,
  type CommandResult,
  type ProviderDoctorAdapters,
} from '../src/services/providers/providerRegistry.js'

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
    expect(text).toContain('claude-code-cli')
    expect(text).toContain('claude')
    expect(text).toContain('antigravity-cli')
    expect(text).toContain('agy')
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

    // Dynamic providers accept any model name
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
    const openaiModels = getValidModelIdsForProvider('openai-api')
    const ollamaModels = getValidModelIdsForProvider('ollama')

    expect(openaiModels).toContain('gpt-5.5')
    expect(openaiModels).toContain('gpt-4o')
    expect(openaiModels).not.toContain('dynamic')

    // Ollama uses dynamic discovery, so no static model IDs
    expect(ollamaModels).toEqual([])
  })

  test('validateProviderModelCompatibility returns valid for compatible pairs', () => {
    const result1 = validateProviderModelCompatibility('openai-api', 'gpt-5.5')
    const result2 = validateProviderModelCompatibility('anthropic-api', 'claude-sonnet-5')
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

  test('validateProviderModelCompatibility handles dynamic providers', () => {
    const result = validateProviderModelCompatibility('ollama', 'any-custom-model')

    expect(result.valid).toBe(true)
  })

  test('validateProviderModelCompatibility handles unknown provider', () => {
    const result = validateProviderModelCompatibility('unknown-provider', 'some-model')

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error).toContain('Unknown provider')
      expect(result.validModels).toEqual([])
    }
  })

  test('changing provider invalidates incompatible model', () => {
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
})
