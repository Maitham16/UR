/**
 * Provider usage → internal usage normalisation.
 *
 * The internal shape is Anthropic's, where the four counters are disjoint and
 * the context total is their sum (see getTokenCountFromUsage):
 *
 *   input_tokens + cache_creation_input_tokens + cache_read_input_tokens + output_tokens
 *
 * Other providers do not partition their counters the same way, so mapping a
 * field across verbatim either loses it or counts it twice:
 *
 *  - OpenAI / OpenRouter Chat Completions: `prompt_tokens` is the *whole*
 *    input including any cache hit reported in
 *    `prompt_tokens_details.cached_tokens`. Copying `cached_tokens` into
 *    cache_read_input_tokens without subtracting it from input_tokens counts
 *    the cached prefix twice.
 *  - `completion_tokens_details.reasoning_tokens` is already inside
 *    `completion_tokens`, so it must never be added to output_tokens.
 *  - Gemini: `cachedContentTokenCount` is likewise part of `promptTokenCount`.
 *
 * Reasoning tokens are preserved on a dedicated field rather than folded into
 * output_tokens, so they can be displayed without disturbing the context sum.
 *
 * Sources:
 *  - https://developers.openai.com/api/docs/guides/prompt-caching
 *  - https://openrouter.ai/docs/use-cases/usage-accounting
 *  - https://ai.google.dev/gemini-api/docs/generate-content/tokens
 */

export type NormalizedUsage = {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  /**
   * Provider-reported reasoning/thinking tokens. Already included in
   * output_tokens for OpenAI-shaped providers; carried separately so display
   * code can show it without double counting.
   */
  reasoning_tokens?: number
  /**
   * The provider's own total, when it reported one. Kept verbatim so a
   * mismatch against the derived sum is detectable instead of silently
   * papered over.
   */
  provider_total_tokens?: number
}

/** Coerce an untrusted numeric field to a non-negative integer. */
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0
  }
  return Math.floor(value)
}

/**
 * Remove the portion of a total that is separately reported, without going
 * negative when a provider's own numbers are inconsistent.
 */
function remainder(total: number, ...parts: number[]): number {
  return Math.max(0, total - parts.reduce((sum, part) => sum + part, 0))
}

function withOptionalFields(
  base: Omit<NormalizedUsage, 'reasoning_tokens' | 'provider_total_tokens'>,
  reasoning: number,
  providerTotal: number,
): NormalizedUsage {
  return {
    ...base,
    ...(reasoning > 0 ? { reasoning_tokens: reasoning } : {}),
    ...(providerTotal > 0 ? { provider_total_tokens: providerTotal } : {}),
  }
}

/**
 * OpenAI and OpenRouter Chat Completions usage.
 *
 * `prompt_tokens` covers the entire input, so the cached and cache-written
 * portions are subtracted out to keep the four counters disjoint.
 */
export function normalizeOpenAIChatUsage(usage: unknown): NormalizedUsage {
  const u = (usage ?? {}) as Record<string, any>
  const promptDetails = (u.prompt_tokens_details ?? {}) as Record<string, unknown>
  const completionDetails = (u.completion_tokens_details ?? {}) as Record<string, unknown>

  const promptTokens = count(u.prompt_tokens)
  const cacheRead = count(promptDetails.cached_tokens)
  const cacheWrite = count(promptDetails.cache_write_tokens)

  return withOptionalFields(
    {
      input_tokens: remainder(promptTokens, cacheRead, cacheWrite),
      output_tokens: count(u.completion_tokens),
      cache_creation_input_tokens: cacheWrite,
      cache_read_input_tokens: cacheRead,
    },
    count(completionDetails.reasoning_tokens),
    count(u.total_tokens),
  )
}

/**
 * OpenAI Responses API usage. Same partitioning problem as Chat Completions:
 * `input_tokens` already contains `input_tokens_details.cached_tokens`.
 */
export function normalizeOpenAIResponsesUsage(usage: unknown): NormalizedUsage {
  const u = (usage ?? {}) as Record<string, any>
  const inputDetails = (u.input_tokens_details ?? {}) as Record<string, unknown>
  const outputDetails = (u.output_tokens_details ?? {}) as Record<string, unknown>

  const inputTokens = count(u.input_tokens)
  const cacheRead = count(inputDetails.cached_tokens)
  const cacheWrite = count(inputDetails.cache_write_tokens)

  return withOptionalFields(
    {
      input_tokens: remainder(inputTokens, cacheRead, cacheWrite),
      output_tokens: count(u.output_tokens),
      cache_creation_input_tokens: cacheWrite,
      cache_read_input_tokens: cacheRead,
    },
    count(outputDetails.reasoning_tokens),
    count(u.total_tokens),
  )
}

/**
 * Gemini `usageMetadata`. `cachedContentTokenCount` is part of
 * `promptTokenCount`. `thoughtsTokenCount` is reported separately and is not
 * added to output, matching the treatment of every other provider here.
 */
export function normalizeGeminiUsage(usage: unknown): NormalizedUsage {
  const u = (usage ?? {}) as Record<string, any>
  const promptTokens = count(u.promptTokenCount)
  const cacheRead = count(u.cachedContentTokenCount)

  return withOptionalFields(
    {
      input_tokens: remainder(promptTokens, cacheRead),
      output_tokens: count(u.candidatesTokenCount),
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: cacheRead,
    },
    count(u.thoughtsTokenCount),
    count(u.totalTokenCount),
  )
}

/**
 * True when a provider reported anything at all. Used to distinguish an
 * absent usage block from a genuinely zero one — see hasReportedTokenUsage.
 */
export function usageWasReported(usage: NormalizedUsage): boolean {
  return (
    usage.input_tokens +
      usage.output_tokens +
      usage.cache_creation_input_tokens +
      usage.cache_read_input_tokens >
    0
  )
}

/**
 * Sum of the four disjoint counters — the value getTokenCountFromUsage
 * derives. Exposed so tests can assert it against the provider's own total.
 */
export function derivedTotal(usage: NormalizedUsage): number {
  return (
    usage.input_tokens +
    usage.cache_creation_input_tokens +
    usage.cache_read_input_tokens +
    usage.output_tokens
  )
}
