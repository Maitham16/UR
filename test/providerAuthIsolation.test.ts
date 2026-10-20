import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { getURHQApiKeyWithSource, isURHQAuthEnabled } from '../src/utils/auth.js'
import { getRuntimeProviderId, type ProviderId } from '../src/services/providers/providerRegistry.js'
import { getSessionSettingsCache, resetSettingsCache, setSessionSettingsCache } from '../src/utils/settings/settingsCache.js'

const names = ['CI', 'NODE_ENV', 'UR_CODE_OAUTH_TOKEN', 'UR_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR', 'UR_CODE_API_KEY_FILE_DESCRIPTOR'] as const
let previousEnvironment: Record<string, string | undefined>
let previousSettings: ReturnType<typeof getSessionSettingsCache>
beforeEach(() => {
  previousEnvironment = Object.fromEntries(names.map(name => [name, process.env[name]]))
  previousSettings = getSessionSettingsCache()
  for (const name of names) delete process.env[name]
})
afterEach(() => {
  for (const name of names) {
    if (previousEnvironment[name] === undefined) delete process.env[name]
    else process.env[name] = previousEnvironment[name]
  }
  resetSettingsCache()
  if (previousSettings) setSessionSettingsCache(previousSettings)
})
function select(provider: ProviderId) {
  // Include the internal legacy subscription placeholder even though new
  // public settings no longer accept it, to preserve its own auth boundary.
  setSessionSettingsCache({ settings: { provider: { active: provider, model: 'auth-fixture-model' } } as never, errors: [] })
  expect(getRuntimeProviderId()).toBe(provider)
}

describe('provider authentication isolation in headless environments', () => {
  for (const context of ['CI', 'NODE_ENV'] as const) {
    test(`${context} does not impose URHQ credentials on API, local/server, or vendor CLI providers`, () => {
      process.env[context] = context === 'CI' ? '1' : 'test'
      for (const provider of ['openai-compatible', 'openai-api', 'anthropic-api', 'gemini-api', 'openrouter', 'ollama', 'lmstudio', 'vllm', 'codex-cli', 'claude-code-cli'] as const) {
        select(provider)
        expect(getURHQApiKeyWithSource()).toEqual({ key: null, source: 'none' })
        expect(isURHQAuthEnabled()).toBe(false)
      }
    })
  }

  test('URHQ subscription authentication retains its own CI token requirement', () => {
    process.env.CI = '1'
    select('subscription')
    expect(() => getURHQApiKeyWithSource()).toThrow('UR_CODE_OAUTH_TOKEN env var is required')
    process.env.UR_CODE_OAUTH_TOKEN = 'test-only-subscription-token'
    expect(getURHQApiKeyWithSource()).toEqual({ key: null, source: 'none' })
  })
})
