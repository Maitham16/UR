import { describe, expect, test } from 'bun:test'
import {
  cycleProviderPickerEffort,
  formatModelSourceLabel,
  formatProviderModelDescription,
  getProviderKeyInputColumns,
  providerPickerStatusWithoutNetwork,
  providerSupportsApiKeyEditing,
  providerSupportsEndpointEditing,
  shouldIncludeProviderModelInPicker,
} from '../src/components/ProviderFirstModelPicker.js'
import { getProviderSelectionRefreshPolicy } from '../src/components/ProviderPicker.js'
import { getProviderDefinition } from '../src/services/providers/providerRegistry.js'
import {
  buildProviderModelLabels,
  compactModelDisplayName,
  fullProviderModelDisplayName,
} from '../src/utils/model/modelPresentation.js'

describe('provider-first model picker presentation', () => {
  test('one-shot task models appear only in a picker with a task-selection handler', () => {
    const agent = { usageMode: 'agent' as const }
    const task = { usageMode: 'task' as const }

    expect(shouldIncludeProviderModelInPicker(agent, false)).toBe(true)
    expect(shouldIncludeProviderModelInPicker(task, false)).toBe(false)
    expect(shouldIncludeProviderModelInPicker(task, true)).toBe(true)
  })

  test('provider selection reuses OpenRouter catalogue cache', () => {
    expect(getProviderSelectionRefreshPolicy('openrouter')).toEqual({})
    expect(getProviderSelectionRefreshPolicy('ollama')).toEqual({ force: true })
  })

  test('Left and Right cycle every supported effort without losing max', () => {
    const extended = ['minimal', 'low', 'high', 'xhigh'] as const
    expect(cycleProviderPickerEffort('high', 'right', extended)).toBe('xhigh')
    expect(cycleProviderPickerEffort('xhigh', 'right', extended)).toBe('minimal')
    expect(cycleProviderPickerEffort('minimal', 'left', extended)).toBe('xhigh')
    expect(cycleProviderPickerEffort('high', 'right', ['low', 'high'])).toBe('low')
    expect(cycleProviderPickerEffort('high', 'right', ['high'])).toBe('high')
    expect(cycleProviderPickerEffort('high', 'right', ['low', 'high', 'max'])).toBe('max')
    expect(cycleProviderPickerEffort('low', 'left', ['low', 'high', 'max'])).toBe('max')
    expect(
      cycleProviderPickerEffort('max', 'right', ['low', 'max', 'ultra']),
    ).toBe('ultra')
    expect(
      cycleProviderPickerEffort('ultra', 'right', ['low', 'max', 'ultra']),
    ).toBe('low')
  })

  test('API key entry stays wide enough without exceeding narrow panes', () => {
    expect(getProviderKeyInputColumns(120)).toBe(100)
    expect(getProviderKeyInputColumns(40)).toBe(20)
    expect(getProviderKeyInputColumns(20)).toBe(8)
    expect(getProviderKeyInputColumns()).toBe(60)
  })

  test('builds the initial provider list without requiring a network doctor', () => {
    const openRouter = getProviderDefinition('openrouter')
    expect(providerPickerStatusWithoutNetwork(openRouter, {}, 'none')).toEqual({
      status: 'missing',
      label: 'OPENROUTER_API_KEY required',
    })
    expect(providerPickerStatusWithoutNetwork(openRouter, {}, 'env')).toEqual({
      status: 'connected',
      label: 'Environment API key ready',
    })

    const ollama = getProviderDefinition('ollama')
    expect(providerPickerStatusWithoutNetwork(ollama, {}, 'none')).toEqual({
      status: 'unknown',
      label: 'Endpoint configured; checked when selected',
    })

    const compatible = getProviderDefinition('openai-compatible')
    expect(providerPickerStatusWithoutNetwork(compatible, {}, 'none')).toEqual({
      status: 'missing',
      label: 'Endpoint required',
    })
    expect(
      providerPickerStatusWithoutNetwork(
        compatible,
        {
          provider: {
            baseUrls: { 'openai-compatible': 'http://localhost:9931/v1' },
          },
        },
        'none',
      ),
    ).toEqual({
      status: 'unknown',
      label: 'Endpoint configured; checked when selected',
    })
  })

  test('requires Unsloth authentication while leaving every API endpoint editable', () => {
    const unsloth = getProviderDefinition('unsloth')
    expect(providerPickerStatusWithoutNetwork(unsloth, {}, 'none')).toEqual({
      status: 'missing',
      label: 'UNSLOTH_API_KEY required',
    })
    expect(providerPickerStatusWithoutNetwork(unsloth, {}, 'stored')).toEqual({
      status: 'unknown',
      label: 'Stored API key and endpoint ready; checked when selected',
    })

    expect(providerSupportsEndpointEditing(unsloth)).toBe(true)
    expect(providerSupportsApiKeyEditing(unsloth)).toBe(true)
    expect(
      providerSupportsApiKeyEditing(getProviderDefinition('openai-compatible')),
    ).toBe(true)
    expect(
      providerSupportsEndpointEditing(getProviderDefinition('openai-api')),
    ).toBe(true)
    expect(
      providerSupportsEndpointEditing(getProviderDefinition('subscription')),
    ).toBe(false)
    expect(
      providerSupportsApiKeyEditing(getProviderDefinition('subscription')),
    ).toBe(false)
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
    expect(formatModelSourceLabel('unavailable')).toBe('× CATALOG UNAVAILABLE')
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
