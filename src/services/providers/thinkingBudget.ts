import type { ModelReasoningCapabilities } from './modelCatalog.js'
import type { ProviderId, ProviderSettings } from './providerRegistry.js'

export type ThinkingBudgetSelection = number | 'default'
export function providerSupportsThinkingBudget(provider: string, capabilities: ModelReasoningCapabilities | undefined): boolean {
  return provider === 'gemini-api' ? capabilities?.thinkingBudget !== undefined
    : provider === 'openrouter' ? capabilities?.supportsMaxTokens === true
    : provider === 'anthropic-api' ? capabilities?.supportsMaxTokens === true && capabilities.thinkingTypes?.includes('enabled') === true : false
}
export function configuredThinkingBudget(provider: ProviderId, model: string, settings: ProviderSettings): number | undefined {
  return settings.thinkingBudgets?.[provider]?.[model]
}
export function validateThinkingBudget(value: ThinkingBudgetSelection, capabilities: ModelReasoningCapabilities | undefined, provider?: string): string | undefined {
  if (value === 'default') return undefined
  if ((provider && !providerSupportsThinkingBudget(provider, capabilities)) || (!capabilities?.thinkingBudget && capabilities?.supportsMaxTokens !== true)) return 'This model does not advertise a native thinking token-budget control supported by this adapter.'
  if (!Number.isSafeInteger(value)) return 'Thinking budget must be an integer.'
  const range = capabilities?.thinkingBudget
  if (value === -1 && range?.dynamic) return undefined
  if (value === 0 && range?.canDisable) return undefined
  if (value < (range?.min ?? 1) || (range && value > range.max)) {
    return range ? `Thinking budget must be ${range.min}–${range.max}${range.dynamic ? ', auto (-1)' : ''}${range.canDisable ? ', or off (0)' : ''}.`
      : 'Thinking budget must be a positive integer; use default to clear it.'
  }
  return undefined
}
export function thinkingBudgetSettingsPatch(provider: ProviderId, model: string, value: ThinkingBudgetSelection,
  settings: ProviderSettings, capabilities: ModelReasoningCapabilities | undefined): ProviderSettings {
  const error = validateThinkingBudget(value, capabilities, provider)
  if (error) throw new Error(error)
  // Explicit undefined removes the selected record key in UR's settings merge.
  return { thinkingBudgets: { ...settings.thinkingBudgets,
    [provider]: { ...settings.thinkingBudgets?.[provider], [model]: value === 'default' ? undefined : value } } } as ProviderSettings
}
