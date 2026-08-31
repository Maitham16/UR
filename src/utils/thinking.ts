// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import type { Theme } from './theme.js'
import { feature } from 'bun:bundle'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { resolveAntModel } from './model/antModels.js'
import { getCanonicalName } from './model/model.js'
import { get3PModelCapabilityOverride } from './model/modelSupportOverrides.js'
import {
  getRuntimeModelReasoningCapabilities,
  getRuntimeProvider,
} from './model/providers.js'
import { getSettingsWithErrors } from './settings/settings.js'
import type {
  ModelReasoningCapabilities,
} from '../services/providers/modelCatalog.js'
import type { ProviderId } from '../services/providers/providerRegistry.js'

export type ThinkingConfig =
  | { type: 'adaptive' }
  | { type: 'enabled'; budgetTokens: number }
  | { type: 'disabled' }

/**
 * Build-time gate (feature) + runtime gate (GrowthBook). The build flag
 * controls code inclusion in external builds; the GB flag controls rollout.
 */
export function isUltrathinkEnabled(): boolean {
  if (!feature('ULTRATHINK')) {
    return false
  }
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_turtle_carbon', true)
}

/**
 * Check if text contains the "ultrathink" keyword.
 */
export function hasUltrathinkKeyword(text: string): boolean {
  return /\bultrathink\b/i.test(text)
}

/**
 * Find positions of "ultrathink" keyword in text (for UI highlighting/notification)
 */
export function findThinkingTriggerPositions(text: string): Array<{
  word: string
  start: number
  end: number
}> {
  const positions: Array<{ word: string; start: number; end: number }> = []
  // Fresh /g literal each call — String.prototype.matchAll copies lastIndex
  // from the source regex, so a shared instance would leak state from
  // hasUltrathinkKeyword's .test() into this call on the next render.
  const matches = text.matchAll(/\bultrathink\b/gi)

  for (const match of matches) {
    if (match.index !== undefined) {
      positions.push({
        word: match[0],
        start: match.index,
        end: match.index + match[0].length,
      })
    }
  }

  return positions
}

const RAINBOW_COLORS: Array<keyof Theme> = [
  'rainbow_red',
  'rainbow_orange',
  'rainbow_yellow',
  'rainbow_green',
  'rainbow_blue',
  'rainbow_indigo',
  'rainbow_violet',
]

const RAINBOW_SHIMMER_COLORS: Array<keyof Theme> = [
  'rainbow_red_shimmer',
  'rainbow_orange_shimmer',
  'rainbow_yellow_shimmer',
  'rainbow_green_shimmer',
  'rainbow_blue_shimmer',
  'rainbow_indigo_shimmer',
  'rainbow_violet_shimmer',
]

export function getRainbowColor(
  charIndex: number,
  shimmer: boolean = false,
): keyof Theme {
  const colors = shimmer ? RAINBOW_SHIMMER_COLORS : RAINBOW_COLORS
  return colors[charIndex % colors.length]!
}

function reasoningMetadataSupportsThinking(
  capabilities: ModelReasoningCapabilities | undefined,
): boolean | undefined {
  if (!capabilities) return undefined
  if (capabilities.supportsThinking !== undefined) {
    return capabilities.supportsThinking
  }
  if (capabilities.supportedEfforts === null) return true
  if (Array.isArray(capabilities.supportedEfforts)) {
    return capabilities.supportedEfforts.length > 0
  }
  if (
    capabilities.defaultEffort !== undefined ||
    capabilities.defaultEnabled !== undefined ||
    capabilities.mandatory !== undefined ||
    capabilities.supportsMaxTokens === true
  ) {
    return true
  }
  return undefined
}

/**
 * Synchronous capability check backed only by provider-authored discovery,
 * model-scoped probes, or an explicit user override. Unknown models are kept
 * unknown/disabled until `ensureProviderReasoningCapabilitiesForModel` has
 * completed; UR never discovers support by sending an optimistic production
 * request and hoping a 400 response explains the provider's schema.
 */
export function modelSupportsThinking(
  model: string,
  provider: ProviderId = getRuntimeProvider(),
): boolean {
  const supported3P = get3PModelCapabilityOverride(model, 'thinking')
  if (supported3P !== undefined) {
    return supported3P
  }
  const discovered = reasoningMetadataSupportsThinking(
    getRuntimeModelReasoningCapabilities(model, provider),
  )
  if (discovered !== undefined) return discovered
  if (process.env.USER_TYPE === 'ant') {
    if (resolveAntModel(model.toLowerCase())) {
      return true
    }
  }
  return false
}

export function modelSupportsAdaptiveThinking(
  model: string,
  provider: ProviderId = getRuntimeProvider(),
): boolean {
  const supported3P = get3PModelCapabilityOverride(model, 'adaptive_thinking')
  if (supported3P !== undefined) {
    return supported3P
  }
  if (provider === 'ollama') {
    return false
  }
  // IMPORTANT: Do not change adaptive thinking support without notifying the
  // model launch DRI and research. This can greatly affect model quality and
  // bashing.
  const capabilities = getRuntimeModelReasoningCapabilities(model, provider)
  if (reasoningMetadataSupportsThinking(capabilities) !== true) return false
  // Claude 4.5 supports only the older budgeted mode. Current Claude 4.6+
  // models and native graded-reasoning APIs use adaptive/provider-native
  // control. An explicit adaptive_thinking override remains authoritative.
  if (provider === 'anthropic-api' && /claude-(?:opus|sonnet)-4[-_.]?5(?:\b|$)/iu.test(model)) {
    return false
  }
  return (
    capabilities?.supportedEfforts === null ||
    (Array.isArray(capabilities?.supportedEfforts) &&
      capabilities.supportedEfforts.length > 0)
  )
}

export function shouldEnableThinkingByDefault(): boolean {
  if (process.env.MAX_THINKING_TOKENS) {
    return parseInt(process.env.MAX_THINKING_TOKENS, 10) > 0
  }

  const { settings } = getSettingsWithErrors()
  if (settings.alwaysThinkingEnabled === false) {
    return false
  }

  // IMPORTANT: Do not change default thinking enabled value without notifying
  // the model launch DRI and research. This can greatly affect model quality and
  // bashing.

  // Enable thinking by default unless explicitly disabled.
  return true
}
