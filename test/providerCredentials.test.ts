import { describe, expect, test } from 'bun:test'
import type { SecureStorage } from '../src/utils/secureStorage/types.js'
import {
  clearProviderApiKey,
  getProviderApiKey,
  getProviderApiKeySource,
  getStoredProviderApiKey,
  hasStoredProviderApiKey,
  setProviderApiKey,
} from '../src/services/providers/providerCredentials.js'

function memoryStorage(initial: Record<string, unknown> = {}): SecureStorage {
  let data: Record<string, unknown> | null = { ...initial }
  return {
    name: 'memory',
    read: () => data,
    readAsync: async () => data,
    update: value => {
      data = value ? { ...(value as Record<string, unknown>) } : null
      return { success: true }
    },
    remove: () => {
      data = null
    },
  }
}

describe('provider credential store', () => {
  test('stores and reads a per-provider API key', () => {
    const storage = memoryStorage()
    const set = setProviderApiKey('openai-api', 'sk-openai-123', { storage })
    expect(set.ok).toBe(true)
    expect(getStoredProviderApiKey('openai-api', { storage })).toBe('sk-openai-123')
    expect(hasStoredProviderApiKey('openai-api', { storage })).toBe(true)
  })

  test('stored key takes precedence over env; env is the fallback', () => {
    const storage = memoryStorage()
    const env = { OPENAI_API_KEY: 'sk-env' }
    // No stored key yet -> env fallback.
    expect(getProviderApiKey('openai-api', { storage, env })).toBe('sk-env')
    expect(getProviderApiKeySource('openai-api', { storage, env })).toBe('env')
    // After storing -> stored wins.
    setProviderApiKey('openai-api', 'sk-stored', { storage })
    expect(getProviderApiKey('openai-api', { storage, env })).toBe('sk-stored')
    expect(getProviderApiKeySource('openai-api', { storage, env })).toBe('stored')
  })

  test('no key anywhere -> undefined / none', () => {
    const storage = memoryStorage()
    expect(getProviderApiKey('anthropic-api', { storage, env: {} })).toBeUndefined()
    expect(getProviderApiKeySource('anthropic-api', { storage, env: {} })).toBe('none')
  })

  test('optional local/server provider keys use their documented env variables', () => {
    const storage = memoryStorage()
    const env = {
      OLLAMA_API_KEY: 'ollama-key',
      LMSTUDIO_API_KEY: 'lmstudio-key',
      LLAMA_CPP_API_KEY: 'llama-cpp-key',
      VLLM_API_KEY: 'vllm-key',
    }
    expect(getProviderApiKey('ollama', { storage, env })).toBe('ollama-key')
    expect(getProviderApiKey('lmstudio', { storage, env })).toBe('lmstudio-key')
    expect(getProviderApiKey('llama.cpp', { storage, env })).toBe('llama-cpp-key')
    expect(getProviderApiKey('vllm', { storage, env })).toBe('vllm-key')
  })

  test('clear removes only that provider and preserves other stored data', () => {
    const storage = memoryStorage({ urAiOauth: { accessToken: 'keep-me' } })
    setProviderApiKey('openai-api', 'sk-a', { storage })
    setProviderApiKey('anthropic-api', 'sk-b', { storage })
    clearProviderApiKey('openai-api', { storage })
    expect(getStoredProviderApiKey('openai-api', { storage })).toBeUndefined()
    expect(getStoredProviderApiKey('anthropic-api', { storage })).toBe('sk-b')
    // Unrelated secure data is untouched.
    expect((storage.read() as any).urAiOauth.accessToken).toBe('keep-me')
  })

  test('provider aliases resolve; unknown provider errors', () => {
    const storage = memoryStorage()
    expect(setProviderApiKey('openai', 'sk-alias', { storage }).ok).toBe(true) // alias -> openai-api
    expect(getStoredProviderApiKey('openai-api', { storage })).toBe('sk-alias')
    expect(setProviderApiKey('nonsense', 'x', { storage }).ok).toBe(false)
    expect(setProviderApiKey('openai-api', '   ', { storage }).ok).toBe(false) // empty
  })
})
