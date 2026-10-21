import { afterEach, describe, expect, test } from 'bun:test'
import {
  calculateOutputLimitBudget,
  getOutputLimitBudget,
} from '../src/query/outputLimitBudget.js'
import {
  cacheProviderModelsForProvider,
  clearProviderModelCacheForTests,
  type ProviderId,
  type ProviderSettings,
} from '../src/services/providers/providerRegistry.js'
import {
  cacheOllamaModelMetadata,
  clearOllamaModelMetadataCacheForTests,
} from '../src/utils/model/ollamaModels.js'
import type { SettingsJson } from '../src/utils/settings/types.js'

afterEach(() => {
  clearProviderModelCacheForTests()
  clearOllamaModelMetadataCacheForTests()
})

describe('output continuation budget calculation', () => {
  test('doubles productive request capacity up to the model output ceiling', () => {
    const common = { modelOutputLimit: 20_000, contextWindow: 200_000, inputTokens: 1_000 }
    expect(calculateOutputLimitBudget({ ...common, currentMaxTokens: 4_096 }))
      .toEqual({ currentMaxTokens: 4_096, ceiling: 20_000, nextMaxTokens: 8_192 })
    expect(calculateOutputLimitBudget({ ...common, currentMaxTokens: 16_384 }))
      .toEqual({ currentMaxTokens: 16_384, ceiling: 20_000, nextMaxTokens: 20_000 })
    expect(calculateOutputLimitBudget({ ...common, currentMaxTokens: 20_000 }))
      .toEqual({ currentMaxTokens: 20_000, ceiling: 20_000 })
  })

  test('reserves 1024 context tokens and retains the actual attempted budget', () => {
    expect(calculateOutputLimitBudget({
      currentMaxTokens: 8_192,
      modelOutputLimit: 64_000,
      contextWindow: 16_384,
      inputTokens: 12_000,
    })).toEqual({ currentMaxTokens: 8_192, ceiling: 3_360 })
    expect(calculateOutputLimitBudget({
      currentMaxTokens: 2_048,
      modelOutputLimit: 64_000,
      contextWindow: 16_384,
      inputTokens: 12_000,
    })).toEqual({ currentMaxTokens: 2_048, ceiling: 3_360, nextMaxTokens: 3_360 })
  })

  test('an explicit cap is a ceiling rather than a target to exceed', () => {
    expect(calculateOutputLimitBudget({
      currentMaxTokens: 4_096,
      modelOutputLimit: 64_000,
      contextWindow: 200_000,
      inputTokens: 1_000,
      explicitMaxTokens: 6_000,
    })).toEqual({ currentMaxTokens: 4_096, ceiling: 6_000, nextMaxTokens: 6_000 })
  })

  test('exhausted context cannot trigger any increase', () => {
    for (const inputTokens of [15_360, 16_384, 20_000, Number.NaN, Infinity]) {
      expect(calculateOutputLimitBudget({
        currentMaxTokens: 4_096,
        modelOutputLimit: 64_000,
        contextWindow: 16_384,
        inputTokens,
      })).toEqual({ currentMaxTokens: 4_096, ceiling: 0 })
    }
  })

  test('normalizes integer boundaries conservatively and fails closed for invalid limits', () => {
    expect(calculateOutputLimitBudget({
      currentMaxTokens: 2_048.9,
      modelOutputLimit: 10_000.9,
      contextWindow: 20_000.9,
      inputTokens: 15_000.1,
    })).toEqual({ currentMaxTokens: 2_048, ceiling: 3_975, nextMaxTokens: 3_975 })
    for (const invalid of [0, -1, Number.NaN, Infinity]) {
      expect(calculateOutputLimitBudget({
        currentMaxTokens: 4_096,
        modelOutputLimit: invalid,
        contextWindow: 200_000,
        inputTokens: 1_000,
      })).toEqual({ currentMaxTokens: 4_096, ceiling: 0 })
    }
  })
})

function cacheModel(
  provider: ProviderId,
  providerSettings: ProviderSettings,
  contextLength: number,
  outputTokenLimit = 64_000,
  model = 'output-budget-fixture',
): void {
  cacheProviderModelsForProvider(provider, [{
    id: model,
    displayName: model,
    description: '',
    contextLength,
    outputTokenLimit,
  }], { provider: providerSettings } as SettingsJson)
}

describe('output continuation budget resolves provider limits', () => {
  test('the same growth policy applies across native API and hosted-runtime providers', () => {
    const providers: ProviderId[] = [
      'openai-api', 'anthropic-api', 'gemini-api', 'openrouter',
      'nvidia-nim', 'nvidia-special', 'openai-compatible',
      'vllm', 'lmstudio', 'llama.cpp', 'unsloth',
    ]
    for (const provider of providers) {
      const providerSettings: ProviderSettings = { active: provider }
      cacheModel(provider, providerSettings, 98_304, 16_384)
      expect(getOutputLimitBudget({
        model: 'output-budget-fixture', provider, providerSettings,
        currentMaxTokens: 4_096, inputTokens: 4_000, env: {},
      })).toEqual({ currentMaxTokens: 4_096, ceiling: 16_384, nextMaxTokens: 8_192 })
    }
  })

  test('uses captured endpoint-specific metadata for the same model name', () => {
    const small: ProviderSettings = { active: 'openai-compatible', baseUrl: 'http://budget-small.invalid/v1' }
    const large: ProviderSettings = { active: 'openai-compatible', baseUrl: 'http://budget-large.invalid/v1' }
    cacheModel('openai-compatible', small, 16_384, 8_192)
    cacheModel('openai-compatible', large, 131_072, 64_000)
    const common = { model: 'output-budget-fixture', provider: 'openai-compatible' as const, currentMaxTokens: 4_096, inputTokens: 12_000, env: {} }
    expect(getOutputLimitBudget({ ...common, providerSettings: small }))
      .toEqual({ currentMaxTokens: 4_096, ceiling: 3_360 })
    expect(getOutputLimitBudget({ ...common, providerSettings: large }))
      .toEqual({ currentMaxTokens: 4_096, ceiling: 64_000, nextMaxTokens: 8_192 })
  })

  test('does not increase above an explicit environment cap', () => {
    const providerSettings: ProviderSettings = { active: 'openrouter' }
    cacheModel('openrouter', providerSettings, 200_000, 16_384)
    const common = { model: 'output-budget-fixture', provider: 'openrouter' as const, providerSettings, inputTokens: 1_000 }
    expect(getOutputLimitBudget({ ...common, currentMaxTokens: 4_096, env: { UR_CODE_MAX_OUTPUT_TOKENS: '6000' } }))
      .toEqual({ currentMaxTokens: 4_096, ceiling: 6_000, nextMaxTokens: 6_000 })
    expect(getOutputLimitBudget({ ...common, currentMaxTokens: 6_000, env: { UR_CODE_MAX_OUTPUT_TOKENS: '6000' } }))
      .toEqual({ currentMaxTokens: 6_000, ceiling: 6_000 })
    expect(getOutputLimitBudget({ ...common, currentMaxTokens: 8_192, env: { UR_CODE_MAX_OUTPUT_TOKENS: '99999999' } }))
      .toEqual({ currentMaxTokens: 8_192, ceiling: 16_384, nextMaxTokens: 16_384 })
  })

  test('invalid environment caps follow request validation instead of disabling recovery', () => {
    const providerSettings: ProviderSettings = { active: 'openrouter' }
    cacheModel('openrouter', providerSettings, 200_000, 64_000)
    for (const value of ['', 'nonsense', '-1', '0']) {
      expect(getOutputLimitBudget({
        model: 'output-budget-fixture', provider: 'openrouter', providerSettings,
        currentMaxTokens: 32_000, inputTokens: 1_000,
        env: { UR_CODE_MAX_OUTPUT_TOKENS: value },
      })).toEqual({ currentMaxTokens: 32_000, ceiling: 64_000, nextMaxTokens: 64_000 })
    }
    // Match the existing parseInt-based request validator exactly.
    expect(getOutputLimitBudget({
      model: 'output-budget-fixture', provider: 'openrouter', providerSettings,
      currentMaxTokens: 1_000, inputTokens: 1_000,
      env: { UR_CODE_MAX_OUTPUT_TOKENS: '3000tokens' },
    })).toEqual({ currentMaxTokens: 1_000, ceiling: 3_000, nextMaxTokens: 2_000 })
  })

  test('Ollama respects the configured context instead of the advertised maximum', () => {
    const providerSettings: ProviderSettings = { active: 'ollama', baseUrl: 'http://budget-ollama.invalid' }
    cacheModel('ollama', providerSettings, 131_072)
    cacheOllamaModelMetadata('output-budget-fixture', {
      model_info: { 'fixture.context_length': 131_072 },
    }, [], 'http://budget-ollama.invalid')
    expect(getOutputLimitBudget({
      model: 'output-budget-fixture', provider: 'ollama', providerSettings,
      currentMaxTokens: 4_096, inputTokens: 12_000,
      env: { UR_OLLAMA_NUM_CTX: '16384' },
    })).toEqual({ currentMaxTokens: 4_096, ceiling: 3_360 })
    expect(getOutputLimitBudget({
      model: 'output-budget-fixture', provider: 'ollama', providerSettings,
      currentMaxTokens: 4_096, inputTokens: 12_000, env: {},
    })).toEqual({ currentMaxTokens: 4_096, ceiling: 19_744, nextMaxTokens: 8_192 })
  })

  test('Ollama context metadata is endpoint scoped and its bucket respects a small model', () => {
    const providerSettings: ProviderSettings = { active: 'ollama', baseUrl: 'http://budget-small-ollama.invalid' }
    cacheOllamaModelMetadata('output-budget-fixture', {
      model_info: { 'fixture.context_length': 16_384 },
    }, [], 'http://budget-small-ollama.invalid')
    cacheOllamaModelMetadata('output-budget-fixture', {
      model_info: { 'fixture.context_length': 131_072 },
    }, [], 'http://unrelated-ollama.invalid')
    expect(getOutputLimitBudget({
      model: 'output-budget-fixture', provider: 'ollama', providerSettings,
      currentMaxTokens: 4_096, inputTokens: 12_000, env: {},
    })).toEqual({ currentMaxTokens: 4_096, ceiling: 3_360 })
  })
})
