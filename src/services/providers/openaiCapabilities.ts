import type { ModelReasoningCapabilities } from './modelCatalog.js'

// https://developers.openai.com/api/docs/guides/reasoning
const five = ['low', 'medium', 'high', 'xhigh', 'max']
const contracts: Record<string, ModelReasoningCapabilities> = {
  'gpt-6-astra': { supportsThinking: true, supportedEfforts: five, defaultEffort: 'medium', mandatory: true },
  'gpt-6.1-sol': { supportsThinking: true, supportedEfforts: five, defaultEffort: 'medium', mandatory: true },
  'gpt-5.5': { supportsThinking: true, supportedEfforts: ['none', 'low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium', mandatory: false },
  ...Object.fromEntries(['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.2'].map(id =>
    [id, { supportsThinking: true, supportedEfforts: ['none', 'low', 'medium', 'high', 'xhigh'], defaultEffort: 'none', mandatory: false }])),
  'gpt-5.1': { supportsThinking: true, supportedEfforts: ['none', 'low', 'medium', 'high'], defaultEffort: 'none', mandatory: false },
  'gpt-5': { supportsThinking: true, supportedEfforts: ['minimal', 'low', 'medium', 'high'], defaultEffort: 'medium', mandatory: true },
  ...Object.fromEntries(['gpt-5.5-pro', 'gpt-5.4-pro', 'gpt-5.2-pro'].map(id =>
    [id, { supportsThinking: true, supportedEfforts: ['medium', 'high', 'xhigh'], defaultEffort: id === 'gpt-5.5-pro' ? 'high' : 'medium', mandatory: true }])),
  ...Object.fromEntries(['gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'].map(id =>
    [id, { supportsThinking: true, supportedEfforts: ['none', ...five], defaultEffort: 'medium', mandatory: false }])),
}
export function getOpenAIReasoningCapabilities(model: string): ModelReasoningCapabilities | undefined {
  return contracts[canonicalModel(model)]
}

/** Only the exact snapshot aliases listed on the published model cards. */
const snapshots: Record<string, string> = {
  'gpt-5.5-2026-04-23': 'gpt-5.5', 'gpt-5.5-pro-2026-04-23': 'gpt-5.5-pro',
  'gpt-5.4-2026-03-05': 'gpt-5.4', 'gpt-5.4-pro-2026-03-05': 'gpt-5.4-pro',
  'gpt-5.4-mini-2026-03-17': 'gpt-5.4-mini', 'gpt-5.4-nano-2026-03-17': 'gpt-5.4-nano',
  'gpt-5.2-2025-12-11': 'gpt-5.2', 'gpt-5.2-pro-2025-12-11': 'gpt-5.2-pro',
  'gpt-5.1-2025-11-13': 'gpt-5.1', 'gpt-5-2025-08-07': 'gpt-5',
}
function canonicalModel(model: string): string {
  const id = model.trim().toLowerCase()
  return snapshots[id] ?? id
}
/** These models need Responses for an agent's reasoning and function calls. */
export function requiresOpenAIResponses(model: string): boolean {
  return ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.5-pro', 'gpt-5.4-pro', 'gpt-5.2-pro'].includes(canonicalModel(model))
}

export type OpenAIServiceTier = 'auto' | 'default' | 'fast' | 'priority' | 'ultrafast' | 'flex'
// Exact published pricing rows; never infer availability from a name prefix.
// https://developers.openai.com/api/docs/pricing
const current = ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']
const fast = new Set([...current, 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.2', 'gpt-5.1', 'gpt-5', 'gpt-5-mini',
  'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-2024-05-13', 'gpt-4o-mini', 'o3', 'o4-mini'])
const flex = new Set([...current, 'gpt-5.5', 'gpt-5.5-pro', 'gpt-5.4', 'gpt-5.4-pro', 'gpt-5.4-mini', 'gpt-5.4-nano',
  'gpt-5.2', 'gpt-5.1', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'o3', 'o4-mini'])
export function getOpenAIServiceTiers(model: string): OpenAIServiceTier[] {
  const id = canonicalModel(model)
  if (!fast.has(id) && !flex.has(id)) return []
  return ['auto', 'default', ...(fast.has(id) ? ['fast'] as const : []),
    ...(['gpt-6-astra', 'gpt-6.1-sol'].includes(id) ? ['ultrafast'] as const : []),
    ...(flex.has(id) ? ['flex'] as const : [])]
}

export function resolveOpenAIServiceTier(model: string, value: unknown, disableFast = false): OpenAIServiceTier | undefined {
  if (disableFast) return value === 'flex' && getOpenAIServiceTiers(model).includes('flex') ? 'flex' : 'default'
  if (value === 'default') return 'default'
  if (value === 'auto' || value === undefined) return undefined
  const canonical = value === 'priority' ? 'fast' : value
  return getOpenAIServiceTiers(model).includes(canonical as OpenAIServiceTier) ? value as OpenAIServiceTier : undefined
}
