import type { ModelReasoningCapabilities } from './modelCatalog.js'

/** https://docs.ollama.com/capabilities/thinking — no model-name inference. */
export function parseOllamaThinkingCapabilities(value: unknown): ModelReasoningCapabilities | undefined {
  if (!value || typeof value !== 'object') return undefined
  const thinking = (value as { thinking?: unknown }).thinking
  if (!thinking || typeof thinking !== 'object') return undefined
  const { values: rawValues, default: defaultValue } = thinking as { values?: unknown; default?: unknown }
  if (!Array.isArray(rawValues)) return undefined
  const values = [...new Set(rawValues.filter((entry): entry is boolean | string =>
    typeof entry === 'boolean' || (typeof entry === 'string' && entry.trim().length > 0)))]
  const efforts = values.filter((entry): entry is string => typeof entry === 'string')
  const supportsThinking = values.some(entry => entry !== false)
  return {
    supportsThinking,
    supportedEfforts: efforts,
    thinkingValues: values,
    mandatory: supportsThinking && !values.includes(false),
    ...(values.includes(defaultValue as boolean | string) ? {
      defaultEnabled: defaultValue !== false,
      ...(typeof defaultValue === 'string' ? { defaultEffort: defaultValue } : {}),
    } : {}),
  }
}
