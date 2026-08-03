import { afterEach, describe, expect, test } from 'bun:test'
import { computeEffectiveContextWindowSize } from '../src/services/compact/autoCompact.js'
import {
  cacheProviderModelsForProvider,
  clearProviderModelCacheForTests,
  getProviderContextLengthForModel,
} from '../src/services/providers/providerRegistry.js'
import type { SettingsJson } from '../src/utils/settings/types.js'

// Explicit settings so the model cache key is derived deterministically rather
// than from whatever provider the test process happens to have active.
const SETTINGS = {
  provider: { active: 'openrouter' },
} as unknown as SettingsJson

afterEach(() => {
  clearProviderModelCacheForTests()
})

function cache(id: string, contextLength?: number): void {
  cacheProviderModelsForProvider(
    'openrouter',
    [
      {
        id,
        displayName: id,
        description: '',
        ...(contextLength === undefined ? {} : { contextLength }),
      },
    ],
    SETTINGS,
  )
}

/**
 * Discovery captures each model's context window and the picker displays it.
 * Reading it back is what lets the compaction threshold match the model that
 * is actually in use rather than a fixed default.
 */
describe('the window a provider reported can be read back', () => {
  test('a reported window is returned', () => {
    cache('moonshotai/kimi-k2', 131_072)
    expect(
      getProviderContextLengthForModel(
        'moonshotai/kimi-k2',
        'openrouter',
        SETTINGS,
      ),
    ).toBe(131_072)
  })

  test('a model reported without a window yields nothing, not a guess', () => {
    cache('silent/model')
    expect(
      getProviderContextLengthForModel('silent/model', 'openrouter', SETTINGS),
    ).toBeUndefined()
  })

  test('a nonsense window is ignored rather than trusted', () => {
    cache('bad/model', 0)
    expect(
      getProviderContextLengthForModel('bad/model', 'openrouter', SETTINGS),
    ).toBeUndefined()
  })

  test('an unknown model reports nothing', () => {
    expect(
      getProviderContextLengthForModel('never/seen', 'openrouter', SETTINGS),
    ).toBeUndefined()
  })
})

/**
 * The summary reserve was a flat ceiling, which only stays below the window
 * while the window is large. A small one would be left negative — every token
 * count above it, so autocompact would fire on every turn and never settle.
 */
describe('the effective window stays usable at every size', () => {
  test('a small window keeps at least four fifths of itself', () => {
    const effective = computeEffectiveContextWindowSize(8_192, 32_000)
    expect(effective).toBeGreaterThanOrEqual(Math.floor(8_192 * 0.8))
    expect(effective).toBeLessThan(8_192)
  })

  test('a large window still reserves the flat amount', () => {
    expect(computeEffectiveContextWindowSize(1_000_000, 64_000)).toBe(
      1_000_000 - 20_000,
    )
  })

  test('a small max-output cap reserves even less', () => {
    // The reserve never exceeds what the model can actually emit.
    expect(computeEffectiveContextWindowSize(200_000, 4_096)).toBe(
      200_000 - 4_096,
    )
  })

  test('the result is never zero or negative for any window', () => {
    for (const window of [1, 2, 512, 2_048, 4_096, 8_192, 32_768, 200_000]) {
      expect(computeEffectiveContextWindowSize(window, 32_000)).toBeGreaterThan(
        0,
      )
    }
  })
})
