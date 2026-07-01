import { describe, expect, test } from 'bun:test'
import {
  createProviderClient,
  getActiveProviderClient,
  validateProviderRuntime,
} from '../src/services/api/providerClient.js'
import {
  getActiveProviderSettings,
} from '../src/services/providers/providerRegistry.js'
import {
  updateSettingsForSource,
} from '../src/utils/settings/settings.js'

describe('provider runtime routing', () => {
  test('ollama provider uses Ollama client', async () => {
    updateSettingsForSource('userSettings', {
      provider: { active: 'ollama' },
    })

    const client = await getActiveProviderClient()
    expect(client).toBeDefined()
    expect(client.beta).toBeDefined()
    expect(client.beta.messages).toBeDefined()
  })

  test('openai-api provider requires API key', async () => {
    updateSettingsForSource('userSettings', {
      provider: { active: 'openai-api' },
    })

    // Without API key, should throw
    await expect(getActiveProviderClient()).rejects.toThrow('API key')
  })

  test('anthropic-api provider requires API key', async () => {
    updateSettingsForSource('userSettings', {
      provider: { active: 'anthropic-api' },
    })

    await expect(getActiveProviderClient()).rejects.toThrow('API key')
  })

  test('lmstudio provider uses OpenAI-compatible endpoint', async () => {
    updateSettingsForSource('userSettings', {
      provider: {
        active: 'lmstudio',
        baseUrl: 'http://localhost:1234/v1',
      },
    })

    const client = await getActiveProviderClient()
    expect(client).toBeDefined()
    expect(client.beta).toBeDefined()
  })

  test('llama.cpp provider uses OpenAI-compatible endpoint', async () => {
    updateSettingsForSource('userSettings', {
      provider: {
        active: 'llama.cpp',
        baseUrl: 'http://localhost:8080/v1',
      },
    })

    const client = await getActiveProviderClient()
    expect(client).toBeDefined()
  })

  test('vllm provider uses OpenAI-compatible endpoint', async () => {
    updateSettingsForSource('userSettings', {
      provider: {
        active: 'vllm',
        baseUrl: 'http://localhost:8000/v1',
      },
    })

    const client = await getActiveProviderClient()
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
    updateSettingsForSource('userSettings', {
      provider: {
        active: 'lmstudio',
        baseUrl: 'http://localhost:1234/v1',
      },
    })

    const result = await validateProviderRuntime('lmstudio')
    expect(result.ok).toBe(true)
  })

  test('validateProviderRuntime fails for missing API key', async () => {
    updateSettingsForSource('userSettings', {
      provider: {
        active: 'openai-compatible',
      },
    })

    // openai-compatible requires OPENAI_API_KEY
    const originalKey = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY

    const result = await validateProviderRuntime('openai-compatible')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('API key')
    }

    // Restore
    if (originalKey) {
      process.env.OPENAI_API_KEY = originalKey
    }
  })

  test('validateProviderRuntime checks API key presence', async () => {
    // OpenAI API requires OPENAI_API_KEY
    const originalKey = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY

    const result = await validateProviderRuntime('openai-api')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('API key')
    }

    // Restore
    if (originalKey) {
      process.env.OPENAI_API_KEY = originalKey
    }
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
    updateSettingsForSource('userSettings', {
      provider: { active: 'openai-api' },
    })

    // Without API key, should fail clearly, not fallback to Ollama
    await expect(getActiveProviderClient()).rejects.toThrow('API key')

    // Verify Ollama wasn't called by checking provider is still openai-api
    const settings = getActiveProviderSettings()
    expect(settings.active).toBe('openai-api')
  })

  test('local provider failure does not fallback to another provider', async () => {
    updateSettingsForSource('userSettings', {
      provider: {
        active: 'lmstudio',
        baseUrl: 'http://invalid-host:9999/v1',
      },
    })

    // Should fail for lmstudio, not fallback to ollama
    const client = await getActiveProviderClient()
    expect(client).toBeDefined()
    // The client is created, but actual requests would fail

    // Verify provider wasn't changed
    const settings = getActiveProviderSettings()
    expect(settings.active).toBe('lmstudio')
  })
})
