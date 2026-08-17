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
    expect(resolveAppliedEffort(MODEL, 'max', 'openrouter')).toBe('max')
    expect(getDisplayedEffortLevel(MODEL, 'max', 'openrouter')).toBe('max')
    expect(toOpenRouterReasoningEffort(MODEL, 'max')).toBe('xhigh')
    expect(executeEffort('max', MODEL).message).toContain(
      'Set effort level to max',
    )
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

  test('max remains the user-facing intent while OpenRouter maps a high-only model', () => {
    const model = 'vendor/high-only'
    expect(modelSupportsMaxEffort(model, 'openrouter')).toBe(true)
    expect(resolveAppliedEffort(model, 'max', 'openrouter')).toBe('max')
    expect(getDisplayedEffortLevel(model, 'max', 'openrouter')).toBe('max')
    expect(toOpenRouterReasoningEffort(model, 'max')).toBe('high')
    expect(executeEffort('max', model).message).toContain(
      'Set effort level to max',
    )
  })
})
