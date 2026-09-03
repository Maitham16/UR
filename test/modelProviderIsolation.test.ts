import { describe, expect, test } from 'bun:test'
import { getConfiguredModelForActiveProvider } from '../src/utils/model/model.js'

describe('provider/model state isolation', () => {
  test('never combines a stale legacy Claude model with Ollama', () => {
    expect(
      getConfiguredModelForActiveProvider({
        model: 'claude-opus-5',
        provider: { active: 'ollama' },
      }),
    ).toBeUndefined()
  })

  test('uses the model committed with the selected provider', () => {
    expect(
      getConfiguredModelForActiveProvider({
        model: 'claude-opus-5',
        provider: {
          active: 'ollama',
          model: 'kimi-k3:cloud',
        },
      }),
    ).toBe('kimi-k3:cloud')
  })

  test('retains compatibility with model-only settings', () => {
    expect(
      getConfiguredModelForActiveProvider({ model: 'kimi-k3:cloud' }),
    ).toBe('kimi-k3:cloud')
  })
})
