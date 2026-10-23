import type { ProviderId, ProviderSettings } from './providerRegistry.js'
import { getAnthropicFastMode } from './anthropicCapabilities.js'
import { getOpenAIServiceTiers } from './openaiCapabilities.js'
import { supportsGeminiServiceTier } from './geminiCapabilities.js'

export type ModelPerformanceMode = 'auto' | 'standard' | 'fast' | 'ultrafast' | 'priority' | 'flex' | 'latency' | 'throughput' | 'price'
export type ModelPerformanceOption = { value: ModelPerformanceMode; label: string }
const labels: Record<ModelPerformanceMode, string> = {
  auto: 'AUTO (provider default)', standard: 'STANDARD', fast: 'FAST (premium pricing)',
  ultrafast: 'ULTRAFAST (higher premium pricing)', priority: 'PRIORITY (premium pricing)',
  flex: 'FLEX (slower, lower cost)', latency: 'LOW LATENCY (provider routing)',
  throughput: 'HIGH THROUGHPUT (provider routing)', price: 'LOWEST PRICE (provider routing)',
}
export function performanceModeLabel(mode: ModelPerformanceMode): string { return labels[mode] }
export function isAcceleratedPerformanceMode(mode: ModelPerformanceMode): boolean {
  return ['fast', 'ultrafast', 'priority', 'latency'].includes(mode)
}
export function getModelPerformanceOptions(provider: string, model: string): ModelPerformanceOption[] {
  let values: ModelPerformanceMode[] = []
  if (provider === 'anthropic-api' && getAnthropicFastMode(model)) values = ['standard', 'fast']
  if (provider === 'openai-api') values = getOpenAIServiceTiers(model).map(tier => tier === 'default' ? 'standard' : tier === 'priority' ? 'fast' : tier)
  if (provider === 'gemini-api' && supportsGeminiServiceTier(model)) values = ['auto', 'standard', 'priority', 'flex']
  // Routing preferences are available across the OpenRouter model catalogue;
  // they request an endpoint preference, not a guaranteed paid speed tier.
  if (provider === 'openrouter') values = ['auto', 'standard', 'latency', 'throughput', 'price']
  return values.map(value => ({ value, label: labels[value] }))
}
export function getSavedModelPerformanceMode(provider: string, model: string, settings: ProviderSettings): ModelPerformanceMode {
  let mode: ModelPerformanceMode = 'auto'
  if (provider === 'anthropic-api') mode = settings.anthropic?.speed ?? 'standard'
  if (provider === 'openai-api') {
    const tier = settings.openai?.serviceTier ?? 'auto'
    mode = tier === 'default' ? 'standard' : tier === 'priority' ? 'fast' : tier
  }
  if (provider === 'gemini-api') mode = settings.gemini?.serviceTier ?? 'auto'
  if (provider === 'openrouter') mode = settings.openrouter?.routing && settings.openrouter.routing !== 'auto'
    ? settings.openrouter.routing : settings.openrouter?.serviceTier === 'default' ? 'standard' : 'auto'
  const options = getModelPerformanceOptions(provider, model)
  return options.some(option => option.value === mode) ? mode : options[0]?.value ?? 'auto'
}
export function preferredFastPerformanceMode(provider: string, model: string): ModelPerformanceMode | undefined {
  const options = getModelPerformanceOptions(provider, model)
  return (['fast', 'priority', 'latency'] as const).find(mode => options.some(option => option.value === mode))
}
export function modelPerformanceSettingsPatch(provider: ProviderId, model: string, mode: ModelPerformanceMode,
  settings: ProviderSettings): ProviderSettings {
  const clearingSpeed = mode === 'standard' && ['anthropic-api', 'openai-api', 'gemini-api'].includes(provider)
  if (!clearingSpeed && !getModelPerformanceOptions(provider, model).some(option => option.value === mode)) {
    throw new Error(`Performance mode ${mode} is not supported for ${model} on ${provider}.`)
  }
  switch (provider) {
    case 'anthropic-api': return { anthropic: { ...settings.anthropic, speed: mode as 'standard' | 'fast' } }
    case 'openai-api': return { openai: { ...settings.openai, serviceTier: mode === 'standard' ? 'default' : mode as NonNullable<ProviderSettings['openai']>['serviceTier'] } }
    case 'gemini-api': return { gemini: { ...settings.gemini, serviceTier: mode as NonNullable<ProviderSettings['gemini']>['serviceTier'] } }
    case 'openrouter': return { openrouter: { ...settings.openrouter,
      routing: mode === 'standard' ? 'auto' : mode as NonNullable<ProviderSettings['openrouter']>['routing'],
      speed: 'standard', serviceTier: mode === 'standard' ? 'default' : 'auto' } }
    default: throw new Error(`No native performance control is available for ${provider}.`)
  }
}
