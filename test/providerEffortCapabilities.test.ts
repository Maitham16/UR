import { describe, expect, test } from 'bun:test'
import {
  getProviderReasoningCapabilitiesForModel,
} from '../src/services/providers/providerRegistry.js'
import {
  getProviderEffortWireValue,
  getSupportedEffortLevelLabelsForModel,
  getSupportedEffortLevelsForModel,
  resolveProviderEffortLevel,
} from '../src/utils/effort.js'

describe('provider effort capability audit', () => {
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
})
