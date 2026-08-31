import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { executeEffort } from '../src/commands/effort/effort.js'
import { toOpenAICompatibleRequest } from '../src/services/api/openaiCompatible.js'
import {
  cacheProviderModelsForProvider,
  clearProviderModelCacheForTests,
  getProviderReasoningCapabilitiesForModel,
} from '../src/services/providers/providerRegistry.js'
import {
  getDisplayedEffortLevel,
  getSupportedEffortLevelsForModel,
  modelSupportsEffort,
  modelSupportsMaxEffort,
  resolveAppliedEffort,
  toOpenRouterReasoningEffort,
} from '../src/utils/effort.js'
import { resetSettingsCache } from '../src/utils/settings/settingsCache.js'

const MODEL = 'qwen/qwen3.8-max'
const previousConfigDir = process.env.UR_CONFIG_DIR
const configDir = mkdtempSync(join(tmpdir(), 'ur-openrouter-effort-'))

function seedOpenRouterReasoningModels(): void {
  cacheProviderModelsForProvider('openrouter', [
    {
      id: MODEL,
      displayName: MODEL,
      description: 'OpenRouter reasoning model',
      supportedParameters: ['reasoning', 'reasoning_effort', 'tools'],
      reasoning: {
        mandatory: true,
        defaultEnabled: true,
        supportedEfforts: ['xhigh', 'high', 'medium', 'low', 'minimal'],
        defaultEffort: 'xhigh',
      },
    },
    {
      id: 'vendor/high-only',
      displayName: 'vendor/high-only',
      description: 'High-only reasoning model',
      supportedParameters: ['reasoning', 'tools'],
      reasoning: { supportedEfforts: ['high', 'low'] },
    },
    {
      id: 'vendor/max-native',
      displayName: 'vendor/max-native',
      description: 'Native max reasoning model',
      supportedParameters: ['reasoning', 'tools'],
      reasoning: { supportedEfforts: ['low', 'high', 'max'] },
    },
    {
      id: 'vendor/ultra-native',
      displayName: 'vendor/ultra-native',
      description: 'Native ultra reasoning model',
      supportedParameters: ['reasoning', 'tools'],
      reasoning: { supportedEfforts: ['low', 'high', 'max', 'ultra'] },
    },
    {
      id: 'vendor/ultra-alias',
      displayName: 'vendor/ultra-alias',
      description: 'Provider-authored ultra alias',
      supportedParameters: ['reasoning', 'tools'],
      reasoning: {
        supportedEfforts: ['low', 'deep'],
        effortAliases: { ultra: 'deep' },
      },
    },
  ])
}

beforeAll(() => {
  process.env.UR_CONFIG_DIR = configDir
  mkdirSync(configDir, { recursive: true })
  writeFileSync(
    join(configDir, 'settings.json'),
    JSON.stringify({
      provider: { active: 'openrouter', model: MODEL },
      model: MODEL,
    }),
  )
  resetSettingsCache()
})

beforeEach(seedOpenRouterReasoningModels)

afterAll(() => {
  clearProviderModelCacheForTests()
  resetSettingsCache()
  if (previousConfigDir === undefined) delete process.env.UR_CONFIG_DIR
  else process.env.UR_CONFIG_DIR = previousConfigDir
  rmSync(configDir, { recursive: true, force: true })
  resetSettingsCache()
})

describe('OpenRouter model-aware effort', () => {
  test('preserves the live model reasoning contract from discovery', () => {
    expect(
      getProviderReasoningCapabilitiesForModel(MODEL, 'openrouter'),
    ).toMatchObject({
      supportedEfforts: ['xhigh', 'high', 'medium', 'low', 'minimal'],
      defaultEffort: 'xhigh',
    })
  })

  test('UR max resolves to Qwen highest effort instead of silently becoming high', () => {
    expect(modelSupportsEffort(MODEL, 'openrouter')).toBe(true)
    expect(modelSupportsMaxEffort(MODEL, 'openrouter')).toBe(true)
    expect(getSupportedEffortLevelsForModel(MODEL, 'openrouter')).toEqual([
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'ultra',
    ])
    expect(resolveAppliedEffort(MODEL, 'max', 'openrouter')).toBe('xhigh')
    expect(getDisplayedEffortLevel(MODEL, 'max', 'openrouter')).toBe('xhigh')
    expect(toOpenRouterReasoningEffort(MODEL, 'max')).toBe('xhigh')
    expect(executeEffort('max', MODEL, 'openrouter').message).toContain(
      'Requested max (this session only); applied xhigh',
    )
  })

  test('Ultra uses an explicitly advertised xhigh ceiling on the exact wire', () => {
    expect(resolveAppliedEffort(MODEL, 'ultra', 'openrouter')).toBe('ultra')
    expect(getDisplayedEffortLevel(MODEL, 'ultra', 'openrouter')).toBe('ultra')
    expect(toOpenRouterReasoningEffort(MODEL, 'ultra')).toBe('xhigh')
  })

  test('OpenRouter receives its unified xhigh reasoning request', () => {
    const request = toOpenAICompatibleRequest(
      {
        model: MODEL,
        messages: [{ role: 'user', content: 'Solve this carefully.' }],
        output_config: { effort: 'max' },
      },
      'openrouter',
    )

    expect(request.reasoning).toEqual({ effort: 'xhigh' })
    expect(request.reasoning_effort).toBeUndefined()
  })

  test('max maps to the exact ceiling of a high-only model', () => {
    const model = 'vendor/high-only'
    expect(modelSupportsMaxEffort(model, 'openrouter')).toBe(true)
    expect(resolveAppliedEffort(model, 'max', 'openrouter')).toBe('high')
    expect(getDisplayedEffortLevel(model, 'max', 'openrouter')).toBe('high')
    expect(toOpenRouterReasoningEffort(model, 'max')).toBe('high')
    expect(executeEffort('max', model, 'openrouter').message).toContain(
      'applied high',
    )
    expect(getSupportedEffortLevelsForModel(model, 'openrouter')).not.toContain(
      'ultra',
    )
    expect(toOpenRouterReasoningEffort(model, 'ultra')).toBeUndefined()
  })

  test('a provider-native max remains max on the wire and in the UI', () => {
    const model = 'vendor/max-native'
    expect(resolveAppliedEffort(model, 'max', 'openrouter')).toBe('max')
    expect(getDisplayedEffortLevel(model, 'max', 'openrouter')).toBe('max')
    expect(toOpenRouterReasoningEffort(model, 'max')).toBe('max')
  })

  test('Ultra preserves an advertised max ceiling and a native ultra value', () => {
    expect(resolveAppliedEffort('vendor/max-native', 'ultra', 'openrouter')).toBe('ultra')
    expect(toOpenRouterReasoningEffort('vendor/max-native', 'ultra')).toBe('max')
    expect(executeEffort('ultra', 'vendor/max-native', 'openrouter').message).toContain(
      'Set effort level to ultra',
    )

    expect(
      getSupportedEffortLevelsForModel('vendor/ultra-native', 'openrouter'),
    ).toEqual(['low', 'high', 'max', 'ultra'])
    expect(resolveAppliedEffort('vendor/ultra-native', 'ultra', 'openrouter')).toBe('ultra')
    expect(toOpenRouterReasoningEffort('vendor/ultra-native', 'ultra')).toBe('ultra')
  })

  test('uses only an explicit provider-authored ultra alias on the wire', () => {
    expect(
      getSupportedEffortLevelsForModel('vendor/ultra-alias', 'openrouter'),
    ).toEqual(['low', 'ultra'])
    expect(resolveAppliedEffort('vendor/ultra-alias', 'ultra', 'openrouter')).toBe('ultra')
    expect(toOpenRouterReasoningEffort('vendor/ultra-alias', 'ultra')).toBe('deep')
    expect(
      toOpenAICompatibleRequest(
        {
          model: 'vendor/ultra-alias',
          messages: [],
          output_config: { effort: 'ultra' },
        },
        'openrouter',
      ).reasoning,
    ).toEqual({ effort: 'deep' })
  })

  test('OpenAI-compatible servers receive the already-resolved exact value', () => {
    expect(
      toOpenAICompatibleRequest(
        {
          model: 'local/reasoner',
          messages: [],
          output_config: { effort: 'xhigh' },
        },
        'llama.cpp',
      ).reasoning_effort,
    ).toBe('xhigh')
    expect(
      toOpenAICompatibleRequest(
        {
          model: 'local/reasoner',
          messages: [],
          output_config: { effort: 'max' },
        },
        'llama.cpp',
      ).reasoning_effort,
    ).toBe('max')
    expect(
      toOpenAICompatibleRequest(
        {
          model: 'local/reasoner',
          messages: [],
          output_config: { effort: 'ultra' },
        },
        'llama.cpp',
      ).reasoning_effort,
    ).toBeUndefined()
  })
})
