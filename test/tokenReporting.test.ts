import { describe, expect, test } from 'bun:test'
import { EMPTY_USAGE } from '../src/services/api/emptyUsage.js'
import {
  formatReportedTokens,
  getTokenCountFromUsage,
  hasReportedTokenUsage,
} from '../src/utils/tokens.js'

const identity = (n: number) => String(n)

function usage(partial: Record<string, unknown>) {
  return { ...EMPTY_USAGE, ...partial } as never
}

describe('reported token usage detection', () => {
  test('the zero-filled substitute is not treated as reported usage', () => {
    // EMPTY_USAGE stands in whenever a provider returns no usage block.
    expect(hasReportedTokenUsage(EMPTY_USAGE as never)).toBe(false)
  })

  test('a missing usage object is not reported usage', () => {
    expect(hasReportedTokenUsage(undefined)).toBe(false)
    expect(hasReportedTokenUsage(null)).toBe(false)
  })

  test('any non-zero counter counts as reported', () => {
    expect(hasReportedTokenUsage(usage({ output_tokens: 12 }))).toBe(true)
    expect(hasReportedTokenUsage(usage({ input_tokens: 7 }))).toBe(true)
    expect(hasReportedTokenUsage(usage({ cache_read_input_tokens: 3 }))).toBe(true)
    expect(hasReportedTokenUsage(usage({ cache_creation_input_tokens: 5 }))).toBe(true)
  })

  test('cached and creation tokens are preserved in the total', () => {
    const u = usage({
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 400,
      cache_creation_input_tokens: 50,
    })
    expect(getTokenCountFromUsage(u)).toBe(570)
  })
})

describe('completion summary token segment', () => {
  test('omitted entirely when the provider reported nothing', () => {
    expect(formatReportedTokens(EMPTY_USAGE as never, 0, identity)).toBeNull()
    expect(formatReportedTokens(undefined, 0, identity)).toBeNull()
  })

  test('never renders a zero even if a total is passed alongside empty usage', () => {
    // The defect: a tool count was shown beside "0 tokens".
    expect(formatReportedTokens(EMPTY_USAGE as never, 0, identity)).toBeNull()
    expect(formatReportedTokens(usage({}), 1234, identity)).toBeNull()
  })

  test('renders the real figure when usage is present', () => {
    expect(formatReportedTokens(usage({ output_tokens: 5 }), 1234, identity)).toBe('1234 tokens')
  })

  test('a non-finite total is treated as unavailable', () => {
    expect(formatReportedTokens(usage({ output_tokens: 5 }), Number.NaN, identity)).toBeNull()
  })

  test('tool count and token figure stay independent quantities', () => {
    // A subagent that ran tools but whose provider reported no usage must show
    // the tool count and no token segment at all.
    const segments = [
      '7 tool uses',
      ...(formatReportedTokens(EMPTY_USAGE as never, 0, identity)
        ? [formatReportedTokens(EMPTY_USAGE as never, 0, identity)]
        : []),
      '1m 4s',
    ]
    expect(segments).toEqual(['7 tool uses', '1m 4s'])
    expect(segments.join(' · ')).not.toContain('0 tokens')
  })
})
