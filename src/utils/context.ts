// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { CONTEXT_1M_BETA_HEADER } from '../constants/betas.js'
import {
  getProviderContextLengthForModel,
  getProviderOutputTokenLimitForModel,
  type ProviderId,
} from '../services/providers/providerRegistry.js'
import { isEnvTruthy } from './envUtils.js'
import { resolveAntModel } from './model/antModels.js'
import { getModelCapability } from './model/modelCapabilities.js'
import { getOllamaContextLengthForModel } from './model/ollamaModels.js'
import { getAPIProvider, type APIProvider } from './model/providers.js'
import type { SettingsJson } from './settings/types.js'

// Model context window size (200k tokens for all models right now)
export const MODEL_CONTEXT_WINDOW_DEFAULT = 200_000

// Maximum output tokens for compact operations
export const COMPACT_MAX_OUTPUT_TOKENS = 20_000

// Default max output tokens
const MAX_OUTPUT_TOKENS_DEFAULT = 32_000
const MAX_OUTPUT_TOKENS_UPPER_LIMIT = 64_000

// Capped default for slot-reservation optimization. BQ p99 output = 4,911
// tokens, so 32k/64k defaults over-reserve 8-16× slot capacity. With the cap
// enabled, <1% of requests hit the limit; those get one clean retry at 64k
// (see query.ts max_output_tokens_escalate). Cap is applied in
// ur.ts:getMaxOutputTokensForModel to avoid the growthbook→betas→context
// import cycle.
export const CAPPED_DEFAULT_MAX_TOKENS = 8_000
export const ESCALATED_MAX_TOKENS = 64_000

/**
 * Check if 1M context is disabled via environment variable.
 * Used by C4E admins to disable 1M context for HIPAA compliance.
 */
export function is1mContextDisabled(): boolean {
  return isEnvTruthy(process.env.UR_CODE_DISABLE_1M_CONTEXT)
}

export function has1mContext(model: string): boolean {
  if (is1mContextDisabled()) {
    return false
  }
  return /\[1m\]/i.test(model)
}

export function modelSupports1M(model: string): boolean {
  if (is1mContextDisabled()) {
    return false
  }
  if (getAPIProvider() === 'ollama') {
    return false
  }
  const cap = getModelCapability(model)
  return Boolean(cap?.max_input_tokens && cap.max_input_tokens >= 1_000_000)
}

export function getContextWindowForModel(
  model: string,
  betas?: string[],
  apiProvider: APIProvider = getAPIProvider(),
): number {
  if (apiProvider === 'ollama') {
    const override = parseInt(process.env.OLLAMA_CONTEXT_TOKENS || '', 10)
    if (!isNaN(override) && override > 0) {
      return override
    }
    const ollamaContextLength = getOllamaContextLengthForModel(model)
    if (ollamaContextLength !== undefined) {
      return ollamaContextLength
    }
  }

  // Allow override via environment variable (ant-only)
  // This takes precedence over all other context window resolution, including 1M detection,
  // so users can cap the effective context window for local decisions (auto-compact, etc.)
  // while still using a 1M-capable endpoint.
  if (
    process.env.USER_TYPE === 'ant' &&
    process.env.UR_CODE_MAX_CONTEXT_TOKENS
  ) {
    const override = parseInt(process.env.UR_CODE_MAX_CONTEXT_TOKENS, 10)
    if (!isNaN(override) && override > 0) {
      return override
    }
  }

  // [1m] suffix — explicit client-side opt-in, respected over all detection
  if (has1mContext(model)) {
    return 1_000_000
  }

  // What the provider itself reported for this model. getModelCapability below
  // is first-party-only, so without this every third-party model resolved to
  // the flat default regardless of its real window: too large for a 32K or
  // 128K model, so autocompact never fired and the provider rejected the turn
  // instead; too small for a 1M model, so it compacted long before it needed
  // to. Discovery already captures this and the model picker displays it.
  const providerContextLength = getProviderContextLengthForModel(model)
  if (providerContextLength !== undefined) {
    return providerContextLength
  }

  const cap = getModelCapability(model)
  if (cap?.max_input_tokens && cap.max_input_tokens >= 100_000) {
    if (
      cap.max_input_tokens > MODEL_CONTEXT_WINDOW_DEFAULT &&
      is1mContextDisabled()
    ) {
      return MODEL_CONTEXT_WINDOW_DEFAULT
    }
    return cap.max_input_tokens
  }

  if (betas?.includes(CONTEXT_1M_BETA_HEADER) && modelSupports1M(model)) {
    return 1_000_000
  }
  if (getmodelS1mExpTreatmentEnabled(model)) {
    return 1_000_000
  }
  if (process.env.USER_TYPE === 'ant') {
    const antModel = resolveAntModel(model)
    if (antModel?.contextWindow) {
      return antModel.contextWindow
    }
  }
  return MODEL_CONTEXT_WINDOW_DEFAULT
}

export function getmodelS1mExpTreatmentEnabled(model: string): boolean {
  if (is1mContextDisabled()) {
    return false
  }
  // No provider-independent model family gets implicit 1M context in this build.
  if (has1mContext(model)) {
    return false
  }
  void model
  return false
}

/**
 * Calculate context window usage percentage from token usage data.
 * Returns used and remaining percentages, or null values if no usage data.
 */
export function calculateContextPercentages(
  currentUsage: {
    input_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  } | null,
  contextWindowSize: number,
): { used: number | null; remaining: number | null } {
  if (!currentUsage) {
    return { used: null, remaining: null }
  }

  const totalInputTokens =
    currentUsage.input_tokens +
    currentUsage.cache_creation_input_tokens +
    currentUsage.cache_read_input_tokens

  const usedPercentage = Math.round(
    (totalInputTokens / contextWindowSize) * 100,
  )
  const clampedUsed = Math.min(100, Math.max(0, usedPercentage))

  return {
    used: clampedUsed,
    remaining: 100 - clampedUsed,
  }
}

/**
 * Returns the model's default and upper limit for max output tokens.
 */
export function getModelMaxOutputTokens(
  model: string,
  provider?: ProviderId | string,
  settings?: SettingsJson,
): {
  default: number
  upperLimit: number
} {
  let defaultTokens = MAX_OUTPUT_TOKENS_DEFAULT
  let upperLimit = MAX_OUTPUT_TOKENS_UPPER_LIMIT

  if (process.env.USER_TYPE === 'ant') {
    const antModel = resolveAntModel(model.toLowerCase())
    if (antModel) {
      defaultTokens = antModel.defaultMaxTokens ?? MAX_OUTPUT_TOKENS_DEFAULT
      upperLimit = antModel.upperMaxTokensLimit ?? MAX_OUTPUT_TOKENS_UPPER_LIMIT
      return { default: defaultTokens, upperLimit }
    }
  }

  const cap = getModelCapability(model)
  if (cap?.max_tokens && cap.max_tokens >= 4_096) {
    upperLimit = cap.max_tokens
    defaultTokens = Math.min(defaultTokens, upperLimit)
  }

  // Live provider catalogues (notably OpenRouter) publish a separate maximum
  // completion size. Respect it for defaults, explicit env validation, compact
  // reserves, and every other caller of this shared capability function.
  const providerOutputLimit = getProviderOutputTokenLimitForModel(
    model,
    provider,
    settings,
  )
  if (providerOutputLimit !== undefined) {
    upperLimit = Math.min(upperLimit, providerOutputLimit)
    defaultTokens = Math.min(defaultTokens, upperLimit)
  }

  return { default: defaultTokens, upperLimit }
}

/**
 * Returns the max thinking budget tokens for a given model. The max
 * thinking tokens should be strictly less than the max output tokens.
 *
 * Deprecated since newer models use adaptive thinking rather than a
 * strict thinking token budget.
 */
export function getMaxThinkingTokensForModel(model: string): number {
  return getModelMaxOutputTokens(model).upperLimit - 1
}
