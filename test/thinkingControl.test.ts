import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import {
  applyEffortCommandState,
  executeEffort,
  showCurrentEffort,
} from '../src/commands/effort/effort.js'
import { executeThinking } from '../src/commands/thinking/thinking.js'
import { toOllamaChatRequest } from '../src/services/api/ollama.js'
import {
  cacheProviderModelsForProvider,
  clearProviderModelCacheForTests,
} from '../src/services/providers/providerRegistry.js'
import { getDefaultAppState } from '../src/state/AppStateStore.js'
import { getSettingsForSource } from '../src/utils/settings/settings.js'
import { resetSettingsCache } from '../src/utils/settings/settingsCache.js'
import {
  resolveSessionThinkingConfig,
  resolveThinkingArrowValue,
  providerSupportsThinkingToggle,
} from '../src/utils/thinking.js'

const configDir = mkdtempSync(join(tmpdir(), 'ur-thinking-control-'))
const previousConfigDir = process.env.UR_CONFIG_DIR

function seedBooleanThinkingModels(): void {
  cacheProviderModelsForProvider('ollama', [
    {
      id: 'kimi-k3:cloud',
      displayName: 'kimi-k3:cloud',
      description: 'Ollama boolean-thinking model',
      reasoning: { supportsThinking: true },
    },
    {
      id: 'plain:latest',
      displayName: 'plain:latest',
      description: 'Ollama non-thinking model',
      reasoning: { supportsThinking: false, supportedEfforts: [] },
    },
  ])
  cacheProviderModelsForProvider('vllm', [
    {
      id: 'server/boolean-reasoner',
      displayName: 'server/boolean-reasoner',
      description: 'Boolean-only compatible endpoint',
      reasoning: { supportsThinking: true },
    },
  ])
}

beforeAll(() => {
  process.env.UR_CONFIG_DIR = configDir
  mkdirSync(configDir, { recursive: true })
  writeFileSync(
    join(configDir, 'settings.json'),
    JSON.stringify({
      provider: { active: 'ollama', model: 'kimi-k3:cloud' },
      model: 'kimi-k3:cloud',
      alwaysThinkingEnabled: false,
    }),
  )
  resetSettingsCache()
})

beforeEach(() => {
  clearProviderModelCacheForTests()
  resetSettingsCache()
  seedBooleanThinkingModels()
})

afterAll(() => {
  clearProviderModelCacheForTests()
  resetSettingsCache()
  if (previousConfigDir === undefined) delete process.env.UR_CONFIG_DIR
  else process.env.UR_CONFIG_DIR = previousConfigDir
  rmSync(configDir, { recursive: true, force: true })
  resetSettingsCache()
})

describe('provider-truthful boolean thinking controls', () => {
  test('/effort max enables thinking without claiming or storing a graded level', () => {
    const result = executeEffort('max', 'kimi-k3:cloud', 'ollama')

    expect(result.message).toContain('Requested max was not sent')
    expect(result.message).toContain('accepts thinking on/off, not graded effort')
    expect(result.message).toContain('/thinking off')
    expect(result.effortUpdate).toBeUndefined()
    expect(result.thinkingUpdate).toEqual({ value: true })

    const state = applyEffortCommandState({
      ...getDefaultAppState(),
      effortValue: 'high',
      thinkingEnabled: false,
    }, result)
    expect(state.effortValue).toBe('high')
    expect(state.thinkingEnabled).toBe(true)
  })

  test('does not claim a boolean control for a transport with no wire mapping', () => {
    const result = executeEffort(
      'high',
      'server/boolean-reasoner',
      'vllm',
    )
    expect(result.message).toContain(
      'vllm runtime exposes neither a provider-native on/off control nor graded effort',
    )
    expect(result.thinkingUpdate).toBeUndefined()
    expect(providerSupportsThinkingToggle('vllm')).toBe(false)
    expect(providerSupportsThinkingToggle('ollama')).toBe(true)

    const preference = executeThinking(
      'on',
      false,
      'server/boolean-reasoner',
      'vllm',
    )
    expect(preference.message).toContain('Thinking preference ON')
    expect(preference.message).toContain(
      'vllm runtime has no provider-native on/off mapping',
    )
  })

  test('models with no reasoning capability still reject effort truthfully', () => {
    const result = executeEffort('max', 'plain:latest', 'ollama')
    expect(result.message).toContain(
      'advertises neither graded reasoning effort nor boolean thinking',
    )
    expect(result.thinkingUpdate).toBeUndefined()
  })

  test('/effort status points boolean models to the direct thinking control', () => {
    expect(
      showCurrentEffort(undefined, 'kimi-k3:cloud', 'ollama', false).message,
    ).toBe(
      'Effort: graded levels unavailable — kimi-k3:cloud on ollama accepts thinking on/off only. Thinking is OFF; use /thinking on|off to change it.',
    )
  })

  test('/thinking changes the durable state and explains the active contract', () => {
    const enabled = executeThinking(
      'on',
      false,
      'kimi-k3:cloud',
      'ollama',
    )
    expect(enabled.thinkingUpdate).toEqual({ value: true })
    expect(enabled.message).toContain('Thinking ON for this session')
    expect(enabled.message).toContain('accepts thinking on/off only')
    resetSettingsCache()
    expect(
      getSettingsForSource('userSettings')?.alwaysThinkingEnabled,
    ).toBeUndefined()

    const disabled = executeThinking(
      'off',
      true,
      'kimi-k3:cloud',
      'ollama',
    )
    expect(disabled.thinkingUpdate).toEqual({ value: false })
    expect(disabled.message).toContain('Thinking OFF for this session')
    resetSettingsCache()
    expect(getSettingsForSource('userSettings')?.alwaysThinkingEnabled).toBe(
      false,
    )
  })

  test('/thinking reports the hard environment override instead of claiming it applied', () => {
    const previous = process.env.UR_CODE_DISABLE_THINKING
    process.env.UR_CODE_DISABLE_THINKING = '1'
    try {
      const result = executeThinking(
        'on',
        false,
        'kimi-k3:cloud',
        'ollama',
      )
      expect(result.thinkingUpdate).toEqual({ value: true })
      expect(result.message).toContain('preference saved as ON')
      expect(result.message).toContain(
        'UR_CODE_DISABLE_THINKING disables it for this session',
      )
    } finally {
      if (previous === undefined) delete process.env.UR_CODE_DISABLE_THINKING
      else process.env.UR_CODE_DISABLE_THINKING = previous
    }
  })

  test('Left/Right and a previously disabled session produce a real enabled request config', () => {
    expect(resolveThinkingArrowValue('left')).toBe(false)
    expect(resolveThinkingArrowValue('right')).toBe(true)
    expect(resolveSessionThinkingConfig({ type: 'disabled' }, true)).toEqual({
      type: 'adaptive',
    })
    expect(resolveSessionThinkingConfig({ type: 'adaptive' }, false)).toEqual({
      type: 'disabled',
    })
  })

  test('Ollama boolean-thinking transport sends think:true, never a fabricated level', () => {
    const request = toOllamaChatRequest(
      {
        model: 'kimi-k3:cloud',
        messages: [],
        thinking: { type: 'enabled', budget_tokens: 8_192 },
      } as never,
      false,
      new Set(['completion', 'tools', 'thinking']),
    )

    expect(request.think).toBe(true)
    expect(typeof request.think).toBe('boolean')
  })
})
