import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  clearProviderModelCacheForTests,
  getProviderRuntimeInfo,
  listModelsForProviderWithSource,
} from '../src/services/providers/providerRegistry.ts'
import {
  assertProviderAllowedOffline,
  resolveProviderBaseUrl,
} from '../src/services/api/providerClient.ts'
import { getConfiguredBaseUrl } from '../src/services/providers/providerConnection.ts'
import {
  clearOllamaBaseUrlOverride,
  getOllamaBaseUrl,
  getOllamaSessionOverride,
  setOllamaBaseUrlOverride,
} from '../src/utils/model/ollamaConfig.ts'

// `ur --discover-ollama` picked a network host and /model still listed local
// models. getOllamaBaseUrl had the right precedence, but the callers read a
// persisted provider.baseUrl *before* consulting it, so a value written by
// `ur config set base_url` silently outranked a host the user had chosen
// seconds earlier. /model-doctor calls getOllamaBaseUrl() directly and was
// correct, which is how the split showed up: two endpoints, one session.
//
// These assert the resolved URL, not the shape of the source. Three earlier
// versions compared string offsets and failed against correct code — once on
// a bad anchor, once on a comment quoting the very expression being ordered.

const PERSISTED_LOCALHOST = {
  provider: { active: 'ollama', baseUrl: 'http://localhost:11434' },
} as never
const PERSISTED_REMOTE = {
  provider: { active: 'ollama', baseUrl: 'http://ollama.example:11434' },
} as never

beforeEach(() => {
  clearProviderModelCacheForTests()
  clearOllamaBaseUrlOverride()
})
afterEach(() => {
  clearProviderModelCacheForTests()
  clearOllamaBaseUrlOverride()
})

/** Records the URL discovery actually requested. */
function recordingFetch(seen: string[]): typeof fetch {
  return (async (input: unknown) => {
    seen.push(String(input))
    return new Response(JSON.stringify({ models: [{ name: 'remote-model' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
}

test('a discovered host is normalized and exposed', () => {
  setOllamaBaseUrlOverride('http://172.20.10.5:11434')
  expect(getOllamaSessionOverride()).toBe('http://172.20.10.5:11434')
  expect(getOllamaBaseUrl({} as never)).toBe('http://172.20.10.5:11434')
})

test('no override means no session host, not an empty string', () => {
  // A falsy-but-present value would make `?? settings.baseUrl` skip the
  // fallback and resolve to nothing.
  expect(getOllamaSessionOverride()).toBeUndefined()
  expect(getOllamaSessionOverride() ?? 'fallback').toBe('fallback')
})

test('the session override outranks the environment', () => {
  setOllamaBaseUrlOverride('http://172.20.10.5:11434')
  expect(
    getOllamaBaseUrl({ OLLAMA_HOST: 'http://elsewhere:11434' } as never),
  ).toBe('http://172.20.10.5:11434')
})

test('runtime requests, status, and connection reporting resolve the same session host', () => {
  setOllamaBaseUrlOverride('http://172.20.10.5:11434')

  expect(resolveProviderBaseUrl('ollama', PERSISTED_LOCALHOST)).toBe(
    'http://172.20.10.5:11434',
  )
  expect(getProviderRuntimeInfo(PERSISTED_LOCALHOST).baseUrl).toBe(
    'http://172.20.10.5:11434',
  )
  expect(getConfiguredBaseUrl('ollama')).toBe('http://172.20.10.5:11434')
})

test('offline gating evaluates the session host rather than a stale persisted host', () => {
  const previousOffline = process.env.UR_OFFLINE
  process.env.UR_OFFLINE = '1'
  try {
    setOllamaBaseUrlOverride('http://172.20.10.5:11434')
    expect(() =>
      assertProviderAllowedOffline('ollama', PERSISTED_LOCALHOST),
    ).toThrow('offline')

    setOllamaBaseUrlOverride('http://localhost:11434')
    expect(() =>
      assertProviderAllowedOffline('ollama', PERSISTED_REMOTE),
    ).not.toThrow()
  } finally {
    if (previousOffline === undefined) {
      delete process.env.UR_OFFLINE
    } else {
      process.env.UR_OFFLINE = previousOffline
    }
  }
})

test('model discovery queries the discovered host, not the persisted one', async () => {
  // The exact configuration that broke: a real settings.json pinning
  // localhost, plus a host chosen this session.
  setOllamaBaseUrlOverride('http://172.20.10.5:11434')
  const seen: string[] = []
  const result = await listModelsForProviderWithSource('ollama', {
    settings: PERSISTED_LOCALHOST,
    adapters: { fetch: recordingFetch(seen) } as never,
  })
  expect(seen).toHaveLength(1)
  expect(seen[0]).toBe('http://172.20.10.5:11434/api/tags')
  expect(seen[0]).not.toContain('localhost')
  expect(result.models.map(model => model.id)).toContain('remote-model')
})

test('without an override the persisted host is still honoured', async () => {
  // The fix must not invert the other way: with no session choice, an
  // explicitly configured base_url is what the user asked for.
  const seen: string[] = []
  await listModelsForProviderWithSource('ollama', {
    settings: PERSISTED_LOCALHOST,
    adapters: { fetch: recordingFetch(seen) } as never,
  })
  expect(seen[0]).toBe('http://localhost:11434/api/tags')
})

test('cached model lists never leak across Ollama endpoints', async () => {
  const hostA = 'http://172.20.10.5:11434'
  const hostB = 'http://172.20.10.6:11434'
  setOllamaBaseUrlOverride(hostA)

  const first = await listModelsForProviderWithSource('ollama', {
    settings: PERSISTED_LOCALHOST,
    adapters: {
      fetch: (async () =>
        new Response(JSON.stringify({ models: [{ name: 'host-a-model' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    } as never,
  })
  expect(first.models.map(model => model.id)).toEqual(['host-a-model'])

  const unreachable = (async () => {
    throw new Error('unreachable')
  }) as unknown as typeof fetch
  setOllamaBaseUrlOverride(hostB)
  const second = await listModelsForProviderWithSource('ollama', {
    settings: PERSISTED_LOCALHOST,
    adapters: { fetch: unreachable } as never,
  })
  expect(second.models.map(model => model.id)).not.toContain('host-a-model')
  expect(second.source).not.toBe('cache')

  // Endpoint A's cache remains useful when returning to that exact host.
  setOllamaBaseUrlOverride(hostA)
  const restored = await listModelsForProviderWithSource('ollama', {
    settings: PERSISTED_LOCALHOST,
    adapters: { fetch: unreachable } as never,
  })
  expect(restored.source).toBe('cache')
  expect(restored.models.map(model => model.id)).toEqual(['host-a-model'])
})
