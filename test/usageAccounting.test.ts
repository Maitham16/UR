import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  derivedTotal,
  normalizeGeminiUsage,
  normalizeOpenAIChatUsage,
  normalizeOpenAIResponsesUsage,
  usageWasReported,
} from '../src/services/api/usageNormalization.js'
import { toOpenAICompatibleRequest } from '../src/services/api/openaiCompatible.js'
import {
  formatReportedTokens,
  getReasoningTokens,
  getTokenCountFromUsage,
  hasReportedTokenUsage,
} from '../src/utils/tokens.js'

const repoRoot = path.resolve(import.meta.dir, '..')
const identity = (n: number) => String(n)

describe('OpenAI / OpenRouter chat usage', () => {
  test('the cached prefix is not counted twice', () => {
    // prompt_tokens is the whole input and already contains cached_tokens.
    const u = normalizeOpenAIChatUsage({
      prompt_tokens: 1000,
      completion_tokens: 50,
      prompt_tokens_details: { cached_tokens: 800 },
      total_tokens: 1050,
    })
    expect(u.input_tokens).toBe(200)
    expect(u.cache_read_input_tokens).toBe(800)
    expect(u.output_tokens).toBe(50)
    // The derived context total must equal the provider's own total.
    expect(derivedTotal(u)).toBe(1050)
    expect(derivedTotal(u)).toBe(u.provider_total_tokens)
  })

  test('cache writes are separated from fresh input', () => {
    const u = normalizeOpenAIChatUsage({
      prompt_tokens: 500,
      completion_tokens: 10,
      prompt_tokens_details: { cached_tokens: 100, cache_write_tokens: 300 },
      total_tokens: 510,
    })
    expect(u.input_tokens).toBe(100)
    expect(u.cache_read_input_tokens).toBe(100)
    expect(u.cache_creation_input_tokens).toBe(300)
    expect(derivedTotal(u)).toBe(510)
  })

  test('reasoning tokens are preserved but never added to output', () => {
    // reasoning_tokens is already inside completion_tokens.
    const u = normalizeOpenAIChatUsage({
      prompt_tokens: 100,
      completion_tokens: 900,
      completion_tokens_details: { reasoning_tokens: 850 },
      total_tokens: 1000,
    })
    expect(u.output_tokens).toBe(900)
    expect(u.reasoning_tokens).toBe(850)
    expect(derivedTotal(u)).toBe(1000)
  })

  test('a response with no details still maps cleanly', () => {
    const u = normalizeOpenAIChatUsage({ prompt_tokens: 10, completion_tokens: 5 })
    expect(u).toMatchObject({
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    })
    expect(u.reasoning_tokens).toBeUndefined()
  })

  test('an absent usage block yields all zeros, not NaN', () => {
    for (const input of [undefined, null, {}, 'nonsense', 42]) {
      const u = normalizeOpenAIChatUsage(input)
      expect(derivedTotal(u)).toBe(0)
      expect(usageWasReported(u)).toBe(false)
    }
  })

  test('inconsistent provider numbers clamp instead of going negative', () => {
    // cached_tokens larger than prompt_tokens must not produce a negative input.
    const u = normalizeOpenAIChatUsage({
      prompt_tokens: 100,
      completion_tokens: 1,
      prompt_tokens_details: { cached_tokens: 500 },
    })
    expect(u.input_tokens).toBe(0)
    expect(u.cache_read_input_tokens).toBe(500)
  })

  test('negative and fractional counters are rejected', () => {
    const u = normalizeOpenAIChatUsage({
      prompt_tokens: -5,
      completion_tokens: 10.7,
    })
    expect(u.input_tokens).toBe(0)
    expect(u.output_tokens).toBe(10)
  })
})

describe('OpenAI Responses usage', () => {
  test('cached input is separated so it is not double counted', () => {
    const u = normalizeOpenAIResponsesUsage({
      input_tokens: 2000,
      output_tokens: 100,
      input_tokens_details: { cached_tokens: 1500 },
      output_tokens_details: { reasoning_tokens: 60 },
      total_tokens: 2100,
    })
    expect(u.input_tokens).toBe(500)
    expect(u.cache_read_input_tokens).toBe(1500)
    expect(u.reasoning_tokens).toBe(60)
    expect(derivedTotal(u)).toBe(2100)
  })
})

describe('Gemini usage', () => {
  test('cached content is separated from prompt tokens', () => {
    const u = normalizeGeminiUsage({
      promptTokenCount: 900,
      candidatesTokenCount: 100,
      cachedContentTokenCount: 400,
      thoughtsTokenCount: 70,
      totalTokenCount: 1000,
    })
    expect(u.input_tokens).toBe(500)
    expect(u.cache_read_input_tokens).toBe(400)
    expect(u.output_tokens).toBe(100)
    expect(u.reasoning_tokens).toBe(70)
    expect(derivedTotal(u)).toBe(1000)
  })

  test('a response without caching or thinking maps unchanged', () => {
    const u = normalizeGeminiUsage({
      promptTokenCount: 12,
      candidatesTokenCount: 3,
    })
    expect(u.input_tokens).toBe(12)
    expect(u.output_tokens).toBe(3)
    expect(u.reasoning_tokens).toBeUndefined()
  })
})

describe('aggregation invariants', () => {
  test('getTokenCountFromUsage matches the provider total for every shape', () => {
    const cases = [
      normalizeOpenAIChatUsage({
        prompt_tokens: 1000,
        completion_tokens: 50,
        prompt_tokens_details: { cached_tokens: 800 },
        total_tokens: 1050,
      }),
      normalizeOpenAIResponsesUsage({
        input_tokens: 2000,
        output_tokens: 100,
        input_tokens_details: { cached_tokens: 1500 },
        total_tokens: 2100,
      }),
      normalizeGeminiUsage({
        promptTokenCount: 900,
        candidatesTokenCount: 100,
        cachedContentTokenCount: 400,
        totalTokenCount: 1000,
      }),
    ]
    for (const u of cases) {
      expect(getTokenCountFromUsage(u as never)).toBe(u.provider_total_tokens)
    }
  })

  test('summing sequential turns does not duplicate the cached prefix', () => {
    // Two turns over the same cached prefix: the cache read is attributed once
    // per turn and never folded back into input_tokens.
    const turns = [
      normalizeOpenAIChatUsage({
        prompt_tokens: 1000,
        completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 900 },
        total_tokens: 1020,
      }),
      normalizeOpenAIChatUsage({
        prompt_tokens: 1100,
        completion_tokens: 30,
        prompt_tokens_details: { cached_tokens: 900 },
        total_tokens: 1130,
      }),
    ]
    const totals = turns.reduce(
      (acc, u) => ({
        input: acc.input + u.input_tokens,
        cacheRead: acc.cacheRead + u.cache_read_input_tokens,
        output: acc.output + u.output_tokens,
      }),
      { input: 0, cacheRead: 0, output: 0 },
    )
    expect(totals.input).toBe(100 + 200)
    expect(totals.cacheRead).toBe(1800)
    expect(totals.output).toBe(50)
    expect(totals.input + totals.cacheRead + totals.output).toBe(1020 + 1130)
  })

  test('a failed turn contributes nothing rather than zeros that read as real', () => {
    const failed = normalizeOpenAIChatUsage(undefined)
    expect(usageWasReported(failed)).toBe(false)
    expect(hasReportedTokenUsage(failed as never)).toBe(false)
    expect(formatReportedTokens(failed as never, derivedTotal(failed), identity)).toBeNull()
  })
})

describe('display of reasoning tokens', () => {
  test('reasoning is surfaced alongside the total when reported', () => {
    const u = normalizeOpenAIChatUsage({
      prompt_tokens: 100,
      completion_tokens: 900,
      completion_tokens_details: { reasoning_tokens: 850 },
      total_tokens: 1000,
    })
    expect(getReasoningTokens(u as never)).toBe(850)
    expect(formatReportedTokens(u as never, derivedTotal(u), identity)).toBe(
      '1000 tokens (850 reasoning)',
    )
  })

  test('no reasoning parenthetical when the provider did not report it', () => {
    const u = normalizeOpenAIChatUsage({ prompt_tokens: 10, completion_tokens: 5 })
    expect(getReasoningTokens(u as never)).toBeUndefined()
    expect(formatReportedTokens(u as never, derivedTotal(u), identity)).toBe('15 tokens')
  })
})

describe('OpenRouter usage accounting follows the current response contract', () => {
  test('deprecated usage request switches are omitted', () => {
    const params = { model: 'x/y', messages: [], max_tokens: 16 }
    const openrouter = toOpenAICompatibleRequest(params, 'openrouter')
    expect(openrouter.usage).toBeUndefined()

    const openai = toOpenAICompatibleRequest(params, 'openai-compatible')
    expect(openai.usage).toBeUndefined()
  })

  test('OpenRouter streaming relies on its mandatory final usage chunk', () => {
    const streamed = toOpenAICompatibleRequest(
      { model: 'x/y', messages: [], max_tokens: 16, stream: true },
      'openrouter',
    )
    expect(streamed.stream_options).toBeUndefined()
    expect(streamed.usage).toBeUndefined()
  })
})

describe('no mapping site bypasses normalisation', () => {
  test('provider adapters do not hand-roll a usage object', () => {
    for (const relative of [
      'src/services/api/openaiCompatible.ts',
      'src/services/api/streamingAdapters.ts',
      'src/services/api/standardAPI.ts',
      'src/services/api/openaiResponses.ts',
    ]) {
      const source = readFileSync(path.join(repoRoot, relative), 'utf8')
      // The old lossy shape: reading prompt_tokens straight into a usage literal.
      expect(source).not.toMatch(/input_tokens:\s*\w+[.?]*\.?usage\?\.\s*prompt_tokens/)
      expect(source).not.toMatch(/input_tokens:\s*usage\?\.promptTokenCount/)
    }
  })
})
