import { describe, expect, test } from 'bun:test'
import type { SecureStorage } from '../src/utils/secureStorage/types.js'
import { setProviderApiKey } from '../src/services/providers/providerCredentials.js'
import {
  getApiConnectionState,
  getProviderConnection,
} from '../src/services/providers/providerConnection.js'

function memoryStorage(): SecureStorage {
  let data: Record<string, unknown> | null = {}
  return {
    name: 'memory',
    read: () => data,
    readAsync: async () => data,
    update: value => {
      data = value ? { ...(value as Record<string, unknown>) } : null
      return { success: true }
    },
  }
}

describe('API provider connection state', () => {
  test('needs-key when nothing is configured', () => {
    const storage = memoryStorage()
    const conn = getApiConnectionState('anthropic-api', { storage, env: {} })
    expect(conn.state).toBe('needs-key')
    expect(conn.keySource).toBe('none')
  })

  test('connected via env', () => {
    const storage = memoryStorage()
    const conn = getApiConnectionState('openai-api', { storage, env: { OPENAI_API_KEY: 'sk-env' } })
    expect(conn.state).toBe('connected')
    expect(conn.keySource).toBe('env')
  })

  test('connected via stored key (survives a fresh process)', () => {
    const storage = memoryStorage()
    setProviderApiKey('openai-api', 'sk-stored', { storage })
    const conn = getApiConnectionState('openai-api', { storage, env: {} })
    expect(conn.state).toBe('connected')
    expect(conn.keySource).toBe('stored')
  })

  test('Unsloth requires its key even though it is a local/server provider', async () => {
    const storage = memoryStorage()
    const missing = await getProviderConnection('unsloth', {
      credentials: { storage, env: {} },
    })
    expect(missing).toMatchObject({
      state: 'needs-key',
      keySource: 'none',
      detail: 'run: ur connect unsloth',
    })

    const connected = await getProviderConnection('unsloth', {
      credentials: {
        storage,
        env: { UNSLOTH_API_KEY: 'studio-key' },
      },
    })
    expect(connected).toMatchObject({
      state: 'connected',
      keySource: 'env',
    })
    expect(connected.detail).toContain('http://localhost:8888/v1')
  })
})
