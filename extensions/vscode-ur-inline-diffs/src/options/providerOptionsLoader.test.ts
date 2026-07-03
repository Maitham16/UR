import { describe, expect, test } from 'bun:test'
import { parseProviderListJson } from './providerOptionsLoader.js'

const RAW_LIST = JSON.stringify([
  {
    id: 'anthropic-api',
    name: 'Claude API',
    accessType: 'api',
    providerKind: 'ur-native',
    usesExternalCli: false,
    supportsNativeToolCalls: true,
    supportsNativeStreaming: true,
    safetyBoundaryLabel: 'UR-native runtime: UR owns provider request shaping...',
  },
  {
    id: 'codex-cli',
    name: 'Codex CLI',
    accessType: 'subscription',
    providerKind: 'subscription-cli',
    usesExternalCli: true,
    supportsNativeToolCalls: false,
    supportsNativeStreaming: false,
    safetyBoundaryLabel: 'External vendor CLI boundary: UR passes prompt text to the official CLI...',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    accessType: 'local',
    providerKind: 'ur-native',
    usesExternalCli: false,
    supportsNativeToolCalls: true,
    supportsNativeStreaming: true,
    safetyBoundaryLabel: 'UR-native runtime: UR owns provider request shaping...',
  },
])

describe('parseProviderListJson', () => {
  test('maps the real CLI shape into ProviderOption[]', () => {
    const options = parseProviderListJson(RAW_LIST)
    expect(options).toHaveLength(3)
    const claude = options.find(o => o.id === 'anthropic-api')
    expect(claude?.displayName).toBe('Claude API')
    expect(claude?.accessType).toBe('api')
    expect(claude?.providerKind).toBe('ur-native')
    expect(claude?.multimodal).toBe(true)
  })

  test('layers the curated multimodal derivation on top (not present in CLI JSON)', () => {
    const options = parseProviderListJson(RAW_LIST)
    expect(options.find(o => o.id === 'codex-cli')?.multimodal).toBe(false)
    expect(options.find(o => o.id === 'ollama')?.multimodal).toBe('unknown')
  })

  test('carries the real safety boundary label through untouched', () => {
    const options = parseProviderListJson(RAW_LIST)
    expect(options.find(o => o.id === 'codex-cli')?.safetyBoundaryLabel).toContain('External vendor CLI boundary')
  })

  test('malformed JSON returns an empty array, never throws', () => {
    expect(() => parseProviderListJson('not json')).not.toThrow()
    expect(parseProviderListJson('not json')).toEqual([])
  })

  test('a bare object instead of an array returns an empty array', () => {
    expect(parseProviderListJson('{}')).toEqual([])
  })

  test('entries missing required fields are skipped', () => {
    const raw = JSON.stringify([{ id: 'x' }, { name: 'y' }])
    expect(parseProviderListJson(raw)).toEqual([])
  })
})
