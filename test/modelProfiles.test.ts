import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadModelProfile, probeModelProfile, profileEndpoint, saveModelProfile } from '../src/services/providers/modelProfiles.js'
import type { ProviderMessageClient } from '../src/services/api/providerClient.js'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true }) })
function client(failure?: 'tools' | 'structured' | 'repeat' | 'boundary'): ProviderMessageClient {
  return { beta: { messages: { create: (params, options) => {
    if ((options?.signal as AbortSignal)?.aborted) throw new Error('aborted')
    if (params.stream) return { withResponse: async () => ({ data: { async *[Symbol.asyncIterator]() { yield { type: 'message_start' }; yield { type: 'content_block_delta' } } } }) }
    const usage = { input_tokens: 4, output_tokens: 5 }
    if (params.tools) return Promise.resolve({ usage, content: [{ type: 'tool_use', id: 'echo-1', name: 'capability_echo', input: { value: 'ur-profile-probe', count: failure === 'tools' ? '2' : 2 } }] })
    if (Array.isArray(params.messages) && params.messages.some(message => Array.isArray(message.content) && message.content.some((block: { type?: string }) => block.type === 'tool_result'))) return Promise.resolve({ usage, content: [{ type: 'text', text: 'ur-profile-probe' }] })
    if (params.output_format) return Promise.resolve({ usage, content: [{ type: 'text', text: failure === 'structured' ? '{"ready":"true","count":2}' : '{"ready":true,"count":2}' }] })
    if (params.max_tokens === 16) return Promise.resolve({ usage, stop_reason: failure === 'boundary' ? 'end_turn' : 'max_tokens', content: [{ type: 'text', text: '1\n2\n3' }] })
    return Promise.resolve({ usage, content: [{ type: 'text', text: failure === 'repeat' ? '1\n2\n3' : '4\n5\n6' }] })
  } } } }
}

test('capability probe verifies observable contracts and records actual completed-response usage', async () => {
  const profile = await probeModelProfile({ provider: 'fixture', model: 'model', endpoint: 'https://user:secret@example.com/v1?key=hidden', client: client(), contextWindow: 32000 })
  expect(Object.values(profile.checks).every(check => check.status === 'verified')).toBe(true)
  expect(profile.usage).toEqual({ inputTokens: 20, outputTokens: 25, requests: 6 })
  expect(profile.endpoint).toBe('https://example.com/v1')
  expect(profile.contextWindow).toEqual({ tokens: 32000, source: 'provider-advertised' })
  expect(profile.defaults).toEqual({ toolCatalog: 'auto', structuredOutput: 'native', contextWindow: 32000 })
})

test('probe failures never become supported model claims or restrict model selection', async () => {
  const tools = await probeModelProfile({ provider: 'fixture', model: 'model', endpoint: 'http://localhost', client: client('tools') })
  expect(tools.checks.tools.status).toBe('failed')
  const structure = await probeModelProfile({ provider: 'fixture', model: 'model', endpoint: 'http://localhost', client: client('structured') })
  expect(structure.checks.structuredOutput.status).toBe('failed')
  expect(structure.defaults.structuredOutput).toBe('validate-text')
  const replay = await probeModelProfile({ provider: 'fixture', model: 'model', endpoint: 'http://localhost', client: client('repeat') })
  expect(replay.checks.continuation.status).toBe('failed')
  const absent = await probeModelProfile({ provider: 'fixture', model: 'model', endpoint: 'http://localhost', client: client('boundary') })
  expect(absent.checks.continuation.status).toBe('unobserved')
})

test('saved evidence is scoped by provider/model/endpoint and stale measurements are labeled', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ur-model-profile-')); dirs.push(root)
  const profile = await probeModelProfile({ provider: 'fixture', model: 'model', endpoint: 'http://localhost:1234/v1', client: client() })
  profile.measuredAt = '2020-01-01T00:00:00Z'
  await saveModelProfile(root, profile)
  expect((await loadModelProfile(root, profile.provider, profile.model, profile.endpoint))?.stale).toBe(true)
  expect(await loadModelProfile(root, profile.provider, 'other-model', profile.endpoint)).toBeNull()
  expect(await loadModelProfile(root, profile.provider, profile.model, 'http://localhost:9999/v1')).toBeNull()
  expect(profileEndpoint('http://user:password@localhost:1234/v1?secret=xxx')).not.toContain('password')
})

test('aborted probing sends no calls and cannot save a partial verified report', async () => {
  const controller = new AbortController(); controller.abort()
  let calls = 0
  const never = { beta: { messages: { create: () => { calls++; throw new Error('unexpected call') } } } } as ProviderMessageClient
  await expect(probeModelProfile({ provider: 'fixture', model: 'model', endpoint: 'http://localhost', client: never, signal: controller.signal })).rejects.toThrow()
  expect(calls).toBe(0)
})

test('a provider ignoring abort cannot leave the diagnostic waiting forever', async () => {
  const never = { beta: { messages: { create: () => new Promise(() => {}) } } } as ProviderMessageClient
  const started = performance.now()
  const profile = await probeModelProfile({ provider: 'fixture', model: 'model', endpoint: 'http://localhost', client: never, timeoutMs: 20 })
  expect(Object.values(profile.checks).every(check => check.status === 'failed')).toBe(true)
  expect(performance.now() - started).toBeLessThan(1000)
})
