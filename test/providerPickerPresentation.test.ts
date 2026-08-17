import { describe, expect, test } from 'bun:test'
import {
  cycleProviderPickerEffort,
  formatModelSourceLabel,
  formatProviderModelDescription,
  getProviderKeyInputColumns,
} from '../src/components/ProviderFirstModelPicker.js'
import {
  buildProviderModelLabels,
  compactModelDisplayName,
  fullProviderModelDisplayName,
} from '../src/utils/model/modelPresentation.js'

describe('provider-first model picker presentation', () => {
  test('Left and Right cycle every supported effort without losing max', () => {
    const extended = ['minimal', 'low', 'high', 'xhigh'] as const
    expect(cycleProviderPickerEffort('high', 'right', extended)).toBe('xhigh')
    expect(cycleProviderPickerEffort('xhigh', 'right', extended)).toBe('minimal')
    expect(cycleProviderPickerEffort('minimal', 'left', extended)).toBe('xhigh')
    expect(cycleProviderPickerEffort('high', 'right', ['low', 'high'])).toBe('low')
    expect(cycleProviderPickerEffort('high', 'right', ['high'])).toBe('high')
  })

  test('API key entry stays wide enough without exceeding narrow panes', () => {
    expect(getProviderKeyInputColumns(120)).toBe(100)
    expect(getProviderKeyInputColumns(40)).toBe(20)
    expect(getProviderKeyInputColumns(20)).toBe(8)
    expect(getProviderKeyInputColumns()).toBe(60)
  })

  test('OpenRouter models show concise live capabilities', () => {
    expect(
      formatProviderModelDescription(
        {
          id: 'vendor/model',
          displayName: 'Model',
          description: 'A capable model',
          pricing: 'free',
          contextLength: 131_072,
          supportedParameters: ['tools', 'reasoning'],
        },
        'live',
        'openrouter',
      ),
    ).toBe('FREE · 131K context · tools · reasoning')
    expect(formatModelSourceLabel('live')).toBe('● LIVE CATALOG')
    expect(formatModelSourceLabel('cache')).toBe('◐ CACHED CATALOG')
  })

  test('OpenRouter labels stay compact while duplicate names remain clear', () => {
    expect(compactModelDisplayName('dots-studio/dots-3-note-preview')).toBe(
      'dots-3-note-preview',
    )
    const labels = buildProviderModelLabels('openrouter', [
      { id: 'vendor-a/shared-model', displayName: 'A very long human name' },
      { id: 'vendor-b/shared-model', displayName: 'Another long human name' },
      { id: 'openai/gpt-5.5', displayName: 'openai/gpt-5.5 (GPT 5.5)' },
    ])

    expect(labels.get('vendor-a/shared-model')).toBe('shared-model · vendor-a')
    expect(labels.get('vendor-b/shared-model')).toBe('shared-model · vendor-b')
    expect(labels.get('openai/gpt-5.5')).toBe('gpt-5.5')
  })

  test('focused OpenRouter details retain the complete untruncated ID', () => {
    const model = {
      id: 'nvidia/nemotron-3.5-content-safety:free',
      displayName: 'nemotron-3.5-content-safety:f…',
    }

    expect(fullProviderModelDisplayName('openrouter', model)).toBe(model.id)
    expect(fullProviderModelDisplayName('openai-api', model)).toBe(
      model.displayName,
    )
  })
})
