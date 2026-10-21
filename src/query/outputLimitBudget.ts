import {
  getProviderContextLengthForModel,
  type ProviderId,
  type ProviderSettings,
} from '../services/providers/providerRegistry.js'
import {
  getModelMaxOutputTokens,
  MODEL_CONTEXT_WINDOW_DEFAULT,
} from '../utils/context.js'
import { isEnvTruthy } from '../utils/envUtils.js'
import { validateBoundedIntEnvVar } from '../utils/envValidation.js'
import { resolveAntModel } from '../utils/model/antModels.js'
import { getModelCapability } from '../utils/model/modelCapabilities.js'
import { getOllamaBaseUrl } from '../utils/model/ollamaConfig.js'
import { getOllamaContextLengthForModel } from '../utils/model/ollamaModels.js'
import {
  computeOllamaNumCtx,
  getOllamaNumCtxOverride,
} from '../utils/model/ollamaTuning.js'
import {
  SELF_HOSTED_DEFAULT_MAX_OUTPUT_TOKENS,
  usesConservativeOutputReservation,
} from '../utils/model/providerRequestTuning.js'
import { getInitialSettings } from '../utils/settings/settings.js'
import type { SettingsJson } from '../utils/settings/types.js'

const CONTEXT_SAFETY_TOKENS = 1_024

export type OutputLimitBudget = {
  /** The actual attempted reservation, even when current headroom is smaller. */
  currentMaxTokens: number
  /** Zero means compaction is needed before any output reservation can fit. */
  ceiling: number
  nextMaxTokens?: number
}

export function calculateOutputLimitBudget(input: {
  currentMaxTokens: number
  modelOutputLimit: number
  contextWindow: number
  inputTokens: number
  explicitMaxTokens?: number
}): OutputLimitBudget {
  const currentMaxTokens = positiveInteger(input.currentMaxTokens) ?? 1
  const modelLimit = positiveInteger(input.modelOutputLimit) ?? 0
  const contextWindow = positiveInteger(input.contextWindow) ?? 0
  const inputTokens = Number.isFinite(input.inputTokens)
    ? Math.max(0, Math.ceil(input.inputTokens))
    : contextWindow
  const headroom = Math.max(0, contextWindow - inputTokens - CONTEXT_SAFETY_TOKENS)
  const explicitLimit = input.explicitMaxTokens === undefined
    ? modelLimit
    : positiveInteger(input.explicitMaxTokens) ?? 0
  const ceiling = Math.min(modelLimit, explicitLimit, headroom)
  const nextMaxTokens = Math.min(currentMaxTokens * 2, ceiling)
  return {
    currentMaxTokens,
    ceiling,
    ...(nextMaxTokens > currentMaxTokens ? { nextMaxTokens } : {}),
  }
}

export function getOutputLimitBudget(input: {
  model: string
  provider: ProviderId
  providerSettings?: ProviderSettings
  currentMaxTokens: number
  inputTokens: number
  env?: Record<string, string | undefined>
}): OutputLimitBudget {
  const env = input.env ?? process.env
  const initialSettings = getInitialSettings()
  const settings = {
    ...initialSettings,
    provider: {
      ...(input.providerSettings ?? initialSettings.provider),
      active: input.provider,
    },
  } as SettingsJson
  const limits = getModelMaxOutputTokens(input.model, input.provider, settings)
  const defaultMaxTokens = usesConservativeOutputReservation(input.provider)
    ? Math.min(limits.default, SELF_HOSTED_DEFAULT_MAX_OUTPUT_TOKENS)
    : limits.default
  const rawCap = env.UR_CODE_MAX_OUTPUT_TOKENS
  const validatedCap = validateBoundedIntEnvVar(
    'UR_CODE_MAX_OUTPUT_TOKENS',
    rawCap,
    defaultMaxTokens,
    limits.upperLimit,
  )
  // An invalid override has the same meaning as in request construction: use
  // the normal default. It must not accidentally become a valid hard ceiling.
  const explicitMaxTokens = rawCap && validatedCap.status !== 'invalid'
    ? validatedCap.effective
    : undefined

  const providerContext = getProviderContextLengthForModel(
    input.model,
    input.provider,
    settings,
  )
  let contextWindow = providerContext ?? fallbackContextWindow(input.model, env)
  if (input.provider === 'ollama') {
    const baseUrl = getOllamaBaseUrl(env, settings)
    const modelContextLength = getOllamaContextLengthForModel(input.model, baseUrl)
      ?? providerContext
    // Match the runtime's configured KV context, including its stable buckets
    // and authoritative UR_OLLAMA_NUM_CTX override, rather than the model's
    // advertised maximum alone.
    contextWindow = computeOllamaNumCtx({
      modelContextLength,
      estimatedPromptTokens: input.inputTokens,
      maxTokens: positiveInteger(input.currentMaxTokens) ?? defaultMaxTokens,
      override: getOllamaNumCtxOverride(env),
    }) ?? contextWindow
  }

  return calculateOutputLimitBudget({
    currentMaxTokens: input.currentMaxTokens,
    modelOutputLimit: limits.upperLimit,
    contextWindow,
    inputTokens: input.inputTokens,
    ...(explicitMaxTokens === undefined ? {} : { explicitMaxTokens }),
  })
}

function positiveInteger(value: number): number | undefined {
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : undefined
}

function fallbackContextWindow(
  model: string,
  env: Record<string, string | undefined>,
): number {
  const disable1m = isEnvTruthy(env.UR_CODE_DISABLE_1M_CONTEXT)
  if (env.USER_TYPE === 'ant') {
    const override = Number.parseInt(env.UR_CODE_MAX_CONTEXT_TOKENS ?? '', 10)
    if (Number.isFinite(override) && override > 0) return override
  }
  if (!disable1m && /\[1m\]/iu.test(model)) return 1_000_000
  const capability = positiveInteger(getModelCapability(model)?.max_input_tokens ?? 0)
  if (capability !== undefined) {
    return disable1m ? Math.min(capability, MODEL_CONTEXT_WINDOW_DEFAULT) : capability
  }
  if (env.USER_TYPE === 'ant') {
    const contextWindow = resolveAntModel(model)?.contextWindow
    if (contextWindow !== undefined) return contextWindow
  }
  // Do not fall back through another provider's active discovery cache when a
  // captured provider/endpoint has no metadata for this model.
  return MODEL_CONTEXT_WINDOW_DEFAULT
}
