import { beforeEach, describe, expect, test } from 'bun:test'
import { toOpenAICompatibleRequest } from '../src/services/api/openaiCompatible.js'
import {
  cacheProviderModelsForProvider,
  clearProviderModelCacheForTests,
  getProviderReasoningCapabilitiesForModel,
} from '../src/services/providers/providerRegistry.js'
import {
  getProviderEffortWireValue,
  getSupportedEffortLevelLabelsForModel,
  getSupportedEffortLevelsForModel,
  resolveProviderEffortLevel,
} from '../src/utils/effort.js'

describe('provider effort capability audit', () => {
  beforeEach(() => clearProviderModelCacheForTests())

  test('OpenAI direct models expose their exact documented ladders', () => {
    expect(getSupportedEffortLevelsForModel('gpt-5.6-sol', 'openai-api')).toEqual([
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'ultra',
    ])
    expect(resolveProviderEffortLevel('gpt-5.6-sol', 'max', 'openai-api')).toBe('max')
    expect(
      getProviderReasoningCapabilitiesForModel('gpt-5.6-sol', 'openai-api')
        ?.effortAliases,
    ).toEqual({ minimal: 'none' })
    expect(
      getProviderEffortWireValue('gpt-5.6-sol', 'minimal', 'openai-api'),
    ).toBe('none')
    expect(resolveProviderEffortLevel('gpt-5.6-sol', 'ultra', 'openai-api')).toBe('ultra')
    expect(
      getProviderEffortWireValue('gpt-5.6-sol', 'ultra', 'openai-api'),
    ).toBe('max')
    expect(
      getSupportedEffortLevelLabelsForModel('gpt-5.6-sol', 'openai-api'),
    ).toEqual([
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'ultra→max',
    ])
    expect(getSupportedEffortLevelsForModel('gpt-4o', 'openai-api')).toEqual(
      [],
    )
  })

  test('Anthropic direct models distinguish xhigh/max support by model', () => {
    expect(
      getSupportedEffortLevelsForModel('claude-sonnet-5', 'anthropic-api'),
    ).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
    expect(
      getSupportedEffortLevelsForModel('claude-opus-5', 'anthropic-api'),
    ).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
    expect(
      getSupportedEffortLevelsForModel('claude-fable-5', 'anthropic-api'),
    ).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
    expect(
      getSupportedEffortLevelsForModel('claude-sonnet-4-6', 'anthropic-api'),
    ).toEqual(['low', 'medium', 'high', 'max', 'ultra'])
    expect(
      getProviderEffortWireValue('claude-opus-5', 'ultra', 'anthropic-api'),
    ).toBe('max')
    expect(
      getProviderEffortWireValue('claude-fable-5', 'ultra', 'anthropic-api'),
    ).toBe('max')
    expect(
      getSupportedEffortLevelsForModel('claude-sonnet-4-5', 'anthropic-api'),
    ).toEqual([])
  })

  test('Gemini direct models expose model-specific thinking levels', () => {
    expect(
      getSupportedEffortLevelsForModel('gemini-3.7-flash', 'gemini-api'),
    ).toEqual(['low', 'medium', 'high'])
    expect(
      getSupportedEffortLevelsForModel('gemini-3.6-flash', 'gemini-api'),
    ).toEqual(['minimal', 'low', 'medium', 'high'])
    expect(
      getSupportedEffortLevelsForModel('gemini-3.5-flash', 'gemini-api'),
    ).toEqual(['minimal', 'low', 'medium', 'high'])
    expect(
      getSupportedEffortLevelsForModel('gemini-3.1-pro', 'gemini-api'),
    ).toEqual(['low', 'medium', 'high'])
    expect(
      getProviderReasoningCapabilitiesForModel(
        'gemini-3.5-flash',
        'gemini-api',
      )?.defaultEffort,
    ).toBe('medium')
  })

  test('vLLM runtime metadata maps none/low/medium/high without fabricating Ultra', () => {
    cacheProviderModelsForProvider('vllm', [{
      id: 'Qwen/Qwen3.5-35B-A3B',
      displayName: 'Qwen/Qwen3.5-35B-A3B',
      description: 'vLLM server-info reasoning contract',
      reasoning: {
        supportsThinking: true,
        supportedEfforts: ['none', 'low', 'medium', 'high'],
        effortAliases: { minimal: 'none' },
      },
    }])

    expect(
      getSupportedEffortLevelsForModel('Qwen/Qwen3.5-35B-A3B', 'vllm'),
    ).toEqual(['minimal', 'low', 'medium', 'high'])
    expect(
      getProviderEffortWireValue('Qwen/Qwen3.5-35B-A3B', 'minimal', 'vllm'),
    ).toBe('none')
    expect(
      getProviderEffortWireValue('Qwen/Qwen3.5-35B-A3B', 'ultra', 'vllm'),
    ).toBeUndefined()
    expect(
      toOpenAICompatibleRequest(
        {
          model: 'Qwen/Qwen3.5-35B-A3B',
          messages: [],
          output_config: { effort: 'minimal' },
        },
        'vllm',
      ).reasoning_effort,
    ).toBe('none')
    expect(
      toOpenAICompatibleRequest(
        {
          model: 'Qwen/Qwen3.5-35B-A3B',
          messages: [],
          output_config: { effort: 'high' },
        },
        'vllm',
      ).reasoning_effort,
    ).toBe('high')
    expect(
      toOpenAICompatibleRequest(
        {
          model: 'Qwen/Qwen3.5-35B-A3B',
          messages: [],
          output_config: { effort: 'ultra' },
        },
        'vllm',
      ).reasoning_effort,
    ).toBeUndefined()
  })

  test('compatible providers honor explicit metadata and keep unknown models disabled', () => {
    for (const provider of [
      'lmstudio',
      'llama.cpp',
      'vllm',
      'unsloth',
      'openai-compatible',
    ] as const) {
      expect(getSupportedEffortLevelsForModel('unknown-model', provider)).toEqual([])
      cacheProviderModelsForProvider(provider, [{
        id: 'provider/model',
        displayName: 'provider/model',
        description: 'provider-authored reasoning contract',
        reasoning: { supportedEfforts: ['low', 'high', 'max'] },
      }])
      expect(
        getSupportedEffortLevelsForModel('provider/model', provider),
      ).toEqual(['low', 'high', 'max', 'ultra'])
      expect(
        getProviderEffortWireValue('provider/model', 'ultra', provider),
      ).toBe('max')
    }
  })

  test('external subscription CLIs do not claim UR-owned effort controls', () => {
    for (const provider of [
      'codex-cli',
      'claude-code-cli',
      'gemini-cli',
      'antigravity-cli',
    ] as const) {
      expect(getSupportedEffortLevelsForModel('provider/model', provider)).toEqual([])
    }
  })
})
