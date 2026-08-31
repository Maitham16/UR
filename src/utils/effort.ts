// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { isUltrathinkEnabled } from './thinking.js'
import { getInitialSettings } from './settings/settings.js'
import { isProSubscriber, isMaxSubscriber, isTeamSubscriber } from './auth.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import {
  getRuntimeProvider,
  getRuntimeModelReasoningCapabilities,
} from './model/providers.js'
import { get3PModelCapabilityOverride } from './model/modelSupportOverrides.js'
import { isEnvTruthy } from './envUtils.js'
import { getAntModelOverrideConfig, resolveAntModel } from './model/antModels.js'
import type { ProviderId } from '../services/providers/providerRegistry.js'
import type { ModelReasoningCapabilities } from '../services/providers/modelCatalog.js'
/**
 * Normalized graded-reasoning values understood by UR provider adapters.
 * `max` is also the provider-neutral "use this model's ceiling" request; when
 * a provider calls that ceiling `xhigh` or `high`, resolution returns that
 * exact wire value before the request is serialized. `ultra` is UR's visible
 * beyond-high ceiling selector. It is offered only when the provider advertises
 * `ultra`, `max`, `xhigh`, or an explicit equivalent, and is translated back to
 * that exact provider wire value.
 */
export type EffortLevel =
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
  | 'ultra'

export const EFFORT_LEVELS = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
] as const satisfies readonly EffortLevel[]

const ESTABLISHED_PROVIDER_EFFORT_LEVELS = EFFORT_LEVELS.filter(
  level => level !== 'ultra',
)

export type EffortValue = EffortLevel | number

const OLLAMA_GRADED_THINK_MODEL_RE = /gpt-oss/i

/**
 * Return the exact provider-authored value represented by UR's Ultra selector.
 *
 * `max` and `xhigh` are established beyond-high ceiling names in the provider
 * APIs UR supports. Arbitrary labels remain ineligible unless discovery gives
 * UR an explicit `ultra` alias, because their relative strength is unknowable.
 */
function getUltraEquivalentWireValue(
  capabilities: ModelReasoningCapabilities | undefined,
): string | undefined {
  if (!Array.isArray(capabilities?.supportedEfforts)) return undefined

  const advertised = new Set(
    capabilities.supportedEfforts
      .map(value => value.trim().toLowerCase())
      .filter(Boolean),
  )
  const explicitAlias = Object.entries(capabilities.effortAliases ?? {}).find(
    ([selector]) => selector.trim().toLowerCase() === 'ultra',
  )?.[1]
  const normalizedAlias = explicitAlias?.trim().toLowerCase()
  if (normalizedAlias && advertised.has(normalizedAlias)) {
    return normalizedAlias
  }
  if (advertised.has('ultra')) return 'ultra'
  if (advertised.has('max')) return 'max'
  if (advertised.has('xhigh')) return 'xhigh'
  return undefined
}

export function normalizeEffortLevels(
  values: readonly string[],
): EffortLevel[] {
  const advertised = new Set(
    values
      .map(value => value.trim().toLowerCase())
      .filter(isEffortLevel),
  )
  return EFFORT_LEVELS.filter(level => advertised.has(level))
}

/**
 * Exact selectable levels for a provider/model pair.
 *
 * An empty array deliberately means "no verified graded effort contract".
 * Boolean thinking is not presented as graded effort. `null` in provider
 * metadata means the endpoint accepts every normalized level.
 */
export function getSupportedEffortLevelsForModel(
  model: string,
  provider: ProviderId = getRuntimeProvider(),
): EffortLevel[] {
  if (isEnvTruthy(process.env.UR_CODE_ALWAYS_ENABLE_EFFORT)) {
    // The diagnostic override enables UR's established normalized ladder, but
    // cannot fabricate a provider's beyond-high Ultra equivalent.
    return [...ESTABLISHED_PROVIDER_EFFORT_LEVELS]
  }

  const supported3P = get3PModelCapabilityOverride(model, 'effort')
  if (supported3P === false) return []
  const supportsExtendedEffort =
    get3PModelCapabilityOverride(model, 'max_effort') !== false
  const applyOverrides = (levels: readonly EffortLevel[]): EffortLevel[] =>
    supportsExtendedEffort
      ? [...levels]
      : levels.filter(
          level => level !== 'xhigh' && level !== 'max' && level !== 'ultra',
        )

  const discovered = getRuntimeModelReasoningCapabilities(model, provider)
  if (discovered?.supportedEfforts === null) {
    // `null` means the gateway accepts the established normalized ladder but
    // does not identify a model-specific beyond-high ceiling for Ultra.
    return applyOverrides(ESTABLISHED_PROVIDER_EFFORT_LEVELS)
  }
  if (discovered?.supportedEfforts !== undefined) {
    const advertisedWireValues = new Set(
      discovered.supportedEfforts.map(value => value.trim().toLowerCase()),
    )
    const advertisedAliases = Object.entries(discovered.effortAliases ?? {})
      .filter(
        ([selector, wireValue]) =>
          isEffortLevel(selector) &&
          advertisedWireValues.has(wireValue.trim().toLowerCase()),
      )
      .map(([selector]) => selector as EffortLevel)
    const ultraEquivalent = getUltraEquivalentWireValue(discovered)
    return applyOverrides(
      normalizeEffortLevels([
        ...discovered.supportedEfforts,
        ...advertisedAliases,
        ...(ultraEquivalent ? ['ultra'] : []),
      ]),
    )
  }
  if (discovered && provider === 'openrouter') {
    // OpenRouter's unified reasoning API accepts normalized effort values even
    // when the model entry omits a finite list.
    return applyOverrides(ESTABLISHED_PROVIDER_EFFORT_LEVELS)
  }

  // Ollama exposes boolean thinking for most models. Only families with a
  // verified graded `think` wire contract get a graded selector.
  if (provider === 'ollama' && OLLAMA_GRADED_THINK_MODEL_RE.test(model)) {
    return ['low', 'medium', 'high']
  }

  if (supported3P === true) {
    return get3PModelCapabilityOverride(model, 'max_effort') === true
      ? [...ESTABLISHED_PROVIDER_EFFORT_LEVELS]
      : ['low', 'medium', 'high']
  }
  if (process.env.USER_TYPE === 'ant' && resolveAntModel(model)) {
    return applyOverrides(ESTABLISHED_PROVIDER_EFFORT_LEVELS)
  }
  return []
}

/** User-facing labels that make UR-to-provider ceiling translation explicit. */
export function getSupportedEffortLevelLabelsForModel(
  model: string,
  provider: ProviderId = getRuntimeProvider(),
): string[] {
  const levels = getSupportedEffortLevelsForModel(model, provider)
  if (!levels.includes('ultra')) return levels
  const nativeUltra = getUltraEquivalentWireValue(
    getRuntimeModelReasoningCapabilities(model, provider),
  )
  return levels.map(level =>
    level === 'ultra' && nativeUltra && nativeUltra !== 'ultra'
      ? `ultra→${nativeUltra}`
      : level,
  )
}

export function getHighestSupportedEffortLevel(
  model: string,
  provider: ProviderId = getRuntimeProvider(),
): EffortLevel | undefined {
  return getSupportedEffortLevelsForModel(model, provider).at(-1)
}

/** Resolve an explicit request to the closest value the model advertises. */
export function resolveProviderEffortLevel(
  model: string,
  requested: EffortLevel,
  provider: ProviderId = getRuntimeProvider(),
): EffortLevel | undefined {
  const supported = getSupportedEffortLevelsForModel(model, provider)
  if (supported.length === 0) return undefined
  // Ultra is a visible selector only for an explicitly advertised beyond-high
  // ceiling. Request serialization preserves the provider's native name.
  if (requested === 'ultra') {
    return supported.includes('ultra') ? 'ultra' : undefined
  }
  if (requested === 'max') {
    if (supported.includes('max')) return 'max'
    return supported.filter(level => level !== 'ultra').at(-1)
  }
  if (supported.includes(requested)) return requested

  const requestedIndex = EFFORT_LEVELS.indexOf(requested)
  const notHigher = supported.filter(
    level => EFFORT_LEVELS.indexOf(level) <= requestedIndex,
  )
  return notHigher.at(-1) ?? supported[0]
}

export function modelSupportsEffort(
  model: string,
  provider: ProviderId = getRuntimeProvider(),
): boolean {
  return getSupportedEffortLevelsForModel(model, provider).length > 0
}

export function modelSupportsMaxEffort(
  model: string,
  provider: ProviderId = getRuntimeProvider(),
): boolean {
  const supported3P = get3PModelCapabilityOverride(model, 'max_effort')
  if (supported3P !== undefined) {
    return supported3P
  }
  // `max` is a provider-neutral request for the model's highest advertised
  // value, so every genuinely graded model can honor it without fabrication.
  return modelSupportsEffort(model, provider)
}

export type OpenRouterReasoningEffort =
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
  | 'ultra'

/**
 * Resolve a normalized UR selector to the exact provider-authored wire value.
 * Ultra normalizes an advertised beyond-high ceiling (`ultra`, `max`, `xhigh`,
 * or an explicit alias). Other alias translation happens only when discovery
 * supplied it and its target is also in the provider's supported effort list.
 */
export function getProviderEffortWireValue(
  model: string,
  requested: EffortLevel,
  provider: ProviderId = getRuntimeProvider(),
): string | undefined {
  const capabilities = getRuntimeModelReasoningCapabilities(model, provider)
  const supported = getSupportedEffortLevelsForModel(model, provider)
  if (requested === 'ultra') {
    if (!supported.includes('ultra')) return undefined
    return getUltraEquivalentWireValue(capabilities)
  }
  if (!supported.includes(requested)) {
    if (requested !== 'max') return undefined
    const resolved = resolveProviderEffortLevel(model, requested, provider)
    return resolved
  }
  const alias = capabilities?.effortAliases?.[requested]
  if (!alias) return requested
  const normalizedAlias = alias.trim().toLowerCase()
  const advertised = capabilities.supportedEfforts
  if (
    Array.isArray(advertised) &&
    advertised.some(value => value.trim().toLowerCase() === normalizedAlias)
  ) {
    return normalizedAlias
  }
  return undefined
}

/**
 * Translate UR's provider-neutral effort vocabulary to the highest truthful
 * OpenRouter value advertised by the selected model. In UR, `max` means the
 * model's maximum capability; several models (including Qwen3.8 Max) call that
 * wire value `xhigh` rather than `max`.
 */
export function toOpenRouterReasoningEffort(
  model: string,
  effort: EffortLevel,
): OpenRouterReasoningEffort | string | undefined {
  return getProviderEffortWireValue(model, effort, 'openrouter')
}

export function isEffortLevel(value: string): value is EffortLevel {
  return (EFFORT_LEVELS as readonly string[]).includes(value)
}

export function parseEffortValue(value: unknown): EffortValue | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  if (typeof value === 'number' && isValidNumericEffort(value)) {
    return value
  }
  const str = String(value).toLowerCase()
  if (isEffortLevel(str)) {
    return str
  }
  const numericValue = parseInt(str, 10)
  if (!isNaN(numericValue) && isValidNumericEffort(numericValue)) {
    return numericValue
  }
  return undefined
}

/**
 * Numeric values are model-default only and not persisted. Exact provider
 * levels persist; provider-neutral `max` remains session-scoped for external
 * users (ants can persist it).
 * Write sites call this before saving to settings so the Zod schema
 * (which only accepts string levels) never rejects a write.
 */
export function toPersistableEffort(
  value: EffortValue | undefined,
): EffortLevel | undefined {
  if (
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh' ||
    value === 'ultra'
  ) {
    return value
  }
  if (value === 'max' && process.env.USER_TYPE === 'ant') {
    return value
  }
  return undefined
}

export function getInitialEffortSetting(): EffortLevel | undefined {
  // toPersistableEffort filters 'max' for non-ants on read, so a manually
  // edited settings.json doesn't leak session-scoped max into a fresh session.
  return toPersistableEffort(getInitialSettings().effortLevel)
}

/**
 * Decide what effort level (if any) to persist when the user selects a model
 * in ModelPicker. Keeps an explicit prior /effort choice sticky even when it
 * matches the picked model's default, while letting purely-default and
 * session-ephemeral effort (CLI --effort, EffortCallout default) fall through
 * to undefined so it follows future model-default changes.
 *
 * priorPersisted must come from userSettings on disk
 * (getSettingsForSource('userSettings')?.effortLevel), NOT merged settings
 * (project/policy layers would leak into the user's global settings.json)
 * and NOT AppState.effortValue (includes session-scoped sources that
 * deliberately do not write to settings.json).
 */
export function resolvePickerEffortPersistence(
  picked: EffortLevel | undefined,
  modelDefault: EffortLevel,
  priorPersisted: EffortLevel | undefined,
  toggledInPicker: boolean,
): EffortLevel | undefined {
  const hadExplicit = priorPersisted !== undefined || toggledInPicker
  return hadExplicit || picked !== modelDefault ? picked : undefined
}

export function getEffortEnvOverride(): EffortValue | null | undefined {
  const envOverride = process.env.UR_CODE_EFFORT_LEVEL
  return envOverride?.toLowerCase() === 'unset' ||
    envOverride?.toLowerCase() === 'auto'
    ? null
    : parseEffortValue(envOverride)
}

/**
 * Resolve the effort value that will actually be sent to the API for a given
 * model, following the full precedence chain:
 *   env UR_CODE_EFFORT_LEVEL → appState.effortValue → model default
 *
 * Returns undefined when no effort parameter should be sent (env set to
 * 'unset', or no default exists for the model).
 */
export function resolveAppliedEffort(
  model: string,
  appStateEffortValue: EffortValue | undefined,
  provider: ProviderId = getRuntimeProvider(),
): EffortValue | undefined {
  const envOverride = getEffortEnvOverride()
  if (envOverride === null) {
    return undefined
  }
  const resolved =
    envOverride ?? appStateEffortValue ?? getDefaultEffortForModel(model, provider)
  if (resolved === undefined || typeof resolved === 'number') return resolved
  return resolveProviderEffortLevel(model, resolved, provider)
}

/**
 * Resolve the effort level to show the user. Wraps resolveAppliedEffort with
 * a conservative high fallback when no effort parameter is sent.
 * Single source of truth for the status bar and /effort output (CC-1088).
 */
export function getDisplayedEffortLevel(
  model: string,
  appStateEffort: EffortValue | undefined,
  provider: ProviderId = getRuntimeProvider(),
): EffortLevel {
  const resolved =
    resolveAppliedEffort(model, appStateEffort, provider) ?? 'high'
  return convertEffortValueToLevel(resolved)
}

/**
 * Build the ` with {level} effort` suffix shown in Logo/Spinner.
 * Returns empty string if the user hasn't explicitly set an effort value.
 * Delegates to resolveAppliedEffort() so the displayed level matches what the
 * API actually receives (including max→xhigh/high provider resolution).
 */
export function getEffortSuffix(
  model: string,
  effortValue: EffortValue | undefined,
  provider: ProviderId = getRuntimeProvider(),
): string {
  if (effortValue === undefined) return ''
  const resolved = resolveAppliedEffort(model, effortValue, provider)
  if (resolved === undefined) return ''
  return ` with ${convertEffortValueToLevel(resolved)} effort`
}

export function isValidNumericEffort(value: number): boolean {
  return Number.isInteger(value)
}

export function convertEffortValueToLevel(value: EffortValue): EffortLevel {
  if (typeof value === 'string') {
    // Runtime guard: value may come from remote config (GrowthBook) where
    // TypeScript types can't help us. Coerce unknown strings to 'high'
    // rather than passing them through unchecked.
    return isEffortLevel(value) ? value : 'high'
  }
  if (process.env.USER_TYPE === 'ant' && typeof value === 'number') {
    if (value <= 50) return 'low'
    if (value <= 85) return 'medium'
    if (value <= 100) return 'high'
    return 'max'
  }
  return 'high'
}

/**
 * Get user-facing description for effort levels
 *
 * @param level The effort level to describe
 * @returns Human-readable description
 */
export function getEffortLevelDescription(level: EffortLevel): string {
  switch (level) {
    case 'minimal':
      return 'Minimal reasoning for the lowest latency and cost'
    case 'low':
      return 'Quick, straightforward implementation with minimal overhead'
    case 'medium':
      return 'Balanced approach with standard implementation and testing'
    case 'high':
      return 'Comprehensive implementation with extensive testing and documentation'
    case 'xhigh':
      return 'Extended reasoning above high where the provider supports it'
    case 'max':
      return 'Maximum capability with deepest reasoning'
    case 'ultra':
      return 'The provider-advertised beyond-high ceiling, using its exact native effort value'
  }
}

/**
 * Get user-facing description for effort values (both string and numeric)
 *
 * @param value The effort value to describe
 * @returns Human-readable description
 */
export function getEffortValueDescription(value: EffortValue): string {
  if (process.env.USER_TYPE === 'ant' && typeof value === 'number') {
    return `[ANT-ONLY] Numeric effort value of ${value}`
  }

  if (typeof value === 'string') {
    return getEffortLevelDescription(value)
  }
  return 'Balanced approach with standard implementation and testing'
}

export type modelODefaultEffortConfig = {
  enabled: boolean
  dialogTitle: string
  dialogDescription: string
}

const MODELO_DEFAULT_EFFORT_CONFIG_DEFAULT: modelODefaultEffortConfig = {
  enabled: true,
  dialogTitle: 'We recommend medium effort for modelO',
  dialogDescription:
    'Effort determines how long UR thinks for when completing your task. We recommend medium effort for most tasks to balance speed and intelligence and maximize rate limits. Use ultrathink to trigger high effort when needed.',
}

export function getmodelODefaultEffortConfig(): modelODefaultEffortConfig {
  const config = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_grey_step2',
    MODELO_DEFAULT_EFFORT_CONFIG_DEFAULT,
  )
  return {
    ...MODELO_DEFAULT_EFFORT_CONFIG_DEFAULT,
    ...config,
  }
}

// @[MODEL LAUNCH]: Update the default effort levels for new models
export function getDefaultEffortForModel(
  model: string,
  provider: ProviderId = getRuntimeProvider(),
): EffortValue | undefined {
  const providerDefault = getRuntimeModelReasoningCapabilities(
    model,
    provider,
  )?.defaultEffort
  if (providerDefault && isEffortLevel(providerDefault)) {
    return resolveProviderEffortLevel(model, providerDefault, provider)
  }

  if (process.env.USER_TYPE === 'ant') {
    const config = getAntModelOverrideConfig()
    const isDefaultModel =
      config?.defaultModel !== undefined &&
      model.toLowerCase() === config.defaultModel.toLowerCase()
    if (isDefaultModel && config?.defaultModelEffortLevel) {
      return config.defaultModelEffortLevel
    }
    const antModel = resolveAntModel(model)
    if (antModel) {
      if (antModel.defaultEffortLevel) {
        return antModel.defaultEffortLevel
      }
      if (antModel.defaultEffortValue !== undefined) {
        return antModel.defaultEffortValue
      }
    }
    // Always default ants to undefined/high
    return undefined
  }

  // IMPORTANT: Do not change the default effort level without notifying
  // the model launch DRI and research. Default effort is a sensitive setting
  // that can greatly affect model quality and bashing.

  if (modelSupportsEffort(model, provider)) {
    if (isProSubscriber()) {
      return 'medium'
    }
    if (
      getmodelODefaultEffortConfig().enabled &&
      (isMaxSubscriber() || isTeamSubscriber())
    ) {
      return 'medium'
    }
  }

  // When ultrathink feature is on, default effort to medium (ultrathink bumps to high)
  if (isUltrathinkEnabled() && modelSupportsEffort(model, provider)) {
    return 'medium'
  }

  // Fallback to undefined, which means we don't set an effort level. This
  // should resolve to high effort level in the API.
  return undefined
}
