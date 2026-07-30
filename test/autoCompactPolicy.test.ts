import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  calculateTokenWarningState,
  getAutoCompactThreshold,
  getEffectiveContextWindowSize,
} from '../src/services/compact/autoCompact.js'
import type { Message } from '../src/types/message.js'
import { appendTeammateMirrorMessage } from '../src/utils/swarm/inProcessRunner.js'
import { createCompactBoundaryMessage } from '../src/utils/messages.js'
import {
  getGlobalConfig,
  saveGlobalConfig,
} from '../src/utils/config.js'
import {
  tokenCountFromLastAPIResponse,
  tokenCountWithEstimation,
} from '../src/utils/tokens.js'

const MODEL = 'claude-sonnet-4-6'
const ENV_KEYS = [
  'DISABLE_COMPACT',
  'DISABLE_AUTO_COMPACT',
  'UR_AUTOCOMPACT_PCT_OVERRIDE',
  'UR_CODE_AUTO_COMPACT_WINDOW',
  'UR_CODE_BLOCKING_LIMIT_OVERRIDE',
] as const

type EnvKey = (typeof ENV_KEYS)[number]

let originalEnv: Record<EnvKey, string | undefined>
let originalAutoCompactEnabled: boolean
let originalAutoThreshold: number | undefined

beforeEach(() => {
  originalEnv = Object.fromEntries(
    ENV_KEYS.map(key => [key, process.env[key]]),
  ) as Record<EnvKey, string | undefined>

  const config = getGlobalConfig()
  originalAutoCompactEnabled = config.autoCompactEnabled
  originalAutoThreshold = config.compactionAutoThreshold
  saveGlobalConfig(current => ({
    ...current,
    autoCompactEnabled: true,
    compactionAutoThreshold: undefined,
  }))

  for (const key of ENV_KEYS) delete process.env[key]
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  saveGlobalConfig(current => ({
    ...current,
    autoCompactEnabled: originalAutoCompactEnabled,
    compactionAutoThreshold: originalAutoThreshold,
  }))
})

describe('auto-compact arithmetic and warning policy', () => {
  test.each(['8000', '16000'])(
    'keeps the trigger positive for a tiny %s-token window',
    tinyWindow => {
      process.env.UR_CODE_AUTO_COMPACT_WINDOW = tinyWindow

      const threshold = getAutoCompactThreshold(MODEL)
      const state = calculateTokenWarningState(0, MODEL)

      expect(threshold).toBeGreaterThan(0)
      expect(Number.isFinite(state.percentLeft)).toBe(true)
      expect(state.percentLeft).toBeGreaterThanOrEqual(0)
      expect(state.percentLeft).toBeLessThanOrEqual(100)
      expect(state.isAboveAutoCompactThreshold).toBe(false)
    },
  )

  test('clamps remaining percentage to the inclusive 0..100 range', () => {
    const belowZero = calculateTokenWarningState(-100_000, MODEL)
    const farAboveThreshold = calculateTokenWarningState(
      getAutoCompactThreshold(MODEL) * 2,
      MODEL,
    )

    expect(belowZero.percentLeft).toBe(100)
    expect(farAboveThreshold.percentLeft).toBe(0)
  })

  test('has a warning-only interval before the error interval', () => {
    const threshold = getAutoCompactThreshold(MODEL)
    let sawWarningOnly = false

    for (let tokenUsage = 0; tokenUsage < threshold; tokenUsage += 250) {
      const state = calculateTokenWarningState(tokenUsage, MODEL)
      if (state.isAboveWarningThreshold && !state.isAboveErrorThreshold) {
        sawWarningOnly = true
        break
      }
    }

    expect(sawWarningOnly).toBe(true)
  })

  test('a configured percentage changes the canonical trigger', () => {
    const defaultThreshold = getAutoCompactThreshold(MODEL)
    saveGlobalConfig(current => ({
      ...current,
      compactionAutoThreshold: 80,
    }))

    const configuredThreshold = getAutoCompactThreshold(MODEL)

    expect(configuredThreshold).toBeGreaterThan(0)
    expect(configuredThreshold).not.toBe(defaultThreshold)
  })

  test('reactive-style warnings use the effective window, not a custom proactive threshold', () => {
    saveGlobalConfig(current => ({
      ...current,
      compactionAutoThreshold: 50,
    }))
    const effectiveWindow = getEffectiveContextWindowSize(MODEL)
    const usage = Math.floor(effectiveWindow * 0.6)

    expect(calculateTokenWarningState(usage, MODEL).isAboveErrorThreshold).toBe(
      true,
    )
    expect(
      calculateTokenWarningState(usage, MODEL, effectiveWindow)
        .isAboveWarningThreshold,
    ).toBe(false)
  })
})

describe('auto-compact progress wiring', () => {
  test('canonical estimation includes messages added after the last API response', () => {
    const messages = [
      {
        type: 'assistant',
        message: {
          id: 'response-1',
          model: MODEL,
          content: [{ type: 'text', text: 'Initial response' }],
          usage: {
            input_tokens: 1_000,
            output_tokens: 100,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: 'new context '.repeat(2_000),
        },
      },
    ] as Message[]

    expect(tokenCountFromLastAPIResponse(messages)).toBe(1_100)
    expect(tokenCountWithEstimation(messages)).toBeGreaterThan(1_100)
  })

  test('prompt notifications use canonical estimated usage for compact progress', () => {
    const source = readFileSync(
      'src/components/PromptInput/Notifications.tsx',
      'utf8',
    )

    expect(source).toContain('tokenCountWithEstimation')
    expect(source).not.toContain('tokenCountFromLastAPIResponse')
  })

  test('/context obtains its threshold from the canonical policy helper', () => {
    const source = readFileSync('src/utils/analyzeContext.ts', 'utf8')

    expect(source).toMatch(
      /getAutoCompactThreshold\(\s*runtimeModel\s*\)/,
    )
    expect(source).not.toMatch(
      /getEffectiveContextWindowSize\([^)]*\)\s*-\s*AUTOCOMPACT_BUFFER_TOKENS/,
    )
    expect(source).toContain('tokenCountWithEstimation')
    expect(source).toContain('getMessagesAfterCompactBoundary')
  })

  test('in-process workers use the normal query-loop compaction policy', () => {
    const source = readFileSync(
      'src/utils/swarm/inProcessRunner.ts',
      'utf8',
    )

    expect(source).toContain('runAgent({')
    expect(source).toContain("querySource: 'agent:custom'")
    expect(source).toContain('isCompactBoundaryMessage')
    expect(source).not.toContain('compactConversation(')
    expect(source).not.toContain('getAutoCompactThreshold(')
  })

  test('in-process task transcript mirrors discard pre-compact messages', () => {
    const before = [
      {
        type: 'user',
        uuid: 'before',
        message: { role: 'user', content: 'old context' },
      },
    ] as Message[]
    const boundary = createCompactBoundaryMessage('auto', 10_000)

    expect(appendTeammateMirrorMessage(before, boundary)).toEqual([
      boundary,
    ])
  })
})
