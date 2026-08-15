import { describe, expect, test } from 'bun:test'
import {
  cycleProviderPickerEffort,
  formatModelSourceLabel,
  formatProviderModelDescription,
  getProviderKeyInputColumns,
} from '../src/components/ProviderFirstModelPicker.js'

describe('provider-first model picker presentation', () => {
  test('Left and Right cycle every supported effort without losing max', () => {
    expect(cycleProviderPickerEffort('high', 'right', true)).toBe('max')
    expect(cycleProviderPickerEffort('max', 'right', true)).toBe('low')
    expect(cycleProviderPickerEffort('low', 'left', true)).toBe('max')
    expect(cycleProviderPickerEffort('high', 'right', false)).toBe('low')
    expect(cycleProviderPickerEffort('max', 'right', false)).toBe('low')
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
})
