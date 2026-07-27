import { expect, test } from 'bun:test'
import { buildOllamaHeaders } from '../src/services/api/ollama.ts'
import {
  getOllamaBaseUrl,
  OLLAMA_CLOUD_BASE_URL,
} from '../src/utils/model/ollamaConfig.ts'

// A local daemon holds the account itself, which is how `:cloud` model suffixes
// resolve locally. A direct connection to the hosted API has no daemon to proxy
// through and must send the key — the gap that made Ollama Cloud unreachable
// from CI.

test('no key configured sends no Authorization header', () => {
  const headers = buildOllamaHeaders({})
  expect(headers['Content-Type']).toBe('application/json')
  expect(headers.Authorization).toBeUndefined()
})

test('a key is sent as a bearer token', () => {
  const headers = buildOllamaHeaders({ OLLAMA_API_KEY: 'sk-test-123' })
  expect(headers.Authorization).toBe('Bearer sk-test-123')
})

test('blank and whitespace-only keys are treated as absent', () => {
  expect(buildOllamaHeaders({ OLLAMA_API_KEY: '' }).Authorization).toBeUndefined()
  expect(
    buildOllamaHeaders({ OLLAMA_API_KEY: '   ' }).Authorization,
  ).toBeUndefined()
})

test('a key is trimmed, so a trailing newline cannot corrupt the header', () => {
  // Keys pasted from a file or `echo` routinely carry a newline; an unsanitized
  // value would produce an invalid header rather than a clean 401.
  const headers = buildOllamaHeaders({ OLLAMA_API_KEY: ' sk-test-123\n' })
  expect(headers.Authorization).toBe('Bearer sk-test-123')
})

test('a key with no host resolves to the hosted API', () => {
  expect(getOllamaBaseUrl({ OLLAMA_API_KEY: 'sk-test' })).toBe(
    OLLAMA_CLOUD_BASE_URL,
  )
})

test('an explicit host always wins over the key-implied cloud default', () => {
  // Self-hosted gateways that require a key must not be redirected to Ollama.
  expect(
    getOllamaBaseUrl({
      OLLAMA_API_KEY: 'sk-test',
      OLLAMA_HOST: 'http://gpu-box:11434',
    }),
  ).toBe('http://gpu-box:11434')
})

test('no key and no host still means localhost', () => {
  expect(getOllamaBaseUrl({})).toBe('http://localhost:11434')
})

test('the CI env scrub passes OLLAMA_API_KEY through to the agent', async () => {
  const { buildSafeAgentEnvironment } = await import(
    '../src/services/agents/agenticCi.ts'
  )
  const env = buildSafeAgentEnvironment({
    OLLAMA_API_KEY: 'sk-test',
    GITHUB_TOKEN: 'ghp_secret',
    SOME_OTHER_TOKEN: 'nope',
  })
  // Provider credentials reach the agent; platform write tokens never do.
  expect(env.OLLAMA_API_KEY).toBe('sk-test')
  expect(env.GITHUB_TOKEN).toBeUndefined()
  expect(env.SOME_OTHER_TOKEN).toBeUndefined()
})
