import type { ModelReasoningCapabilities } from './modelCatalog.js'

// https://ai.google.dev/gemini-api/docs/generate-content/thinking
const levels = ['low', 'medium', 'high']
const contracts: Record<string, ModelReasoningCapabilities> = {
  ...Object.fromEntries(['gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.7-flash'].map(id =>
    [id, { supportsThinking: true, supportedEfforts: levels, defaultEffort: 'medium', mandatory: true }])),
  ...Object.fromEntries(['gemini-3.6-flash', 'gemini-3.5-flash'].map(id =>
    [id, { supportsThinking: true, supportedEfforts: ['minimal', ...levels], defaultEffort: 'medium', mandatory: true }])),
  ...Object.fromEntries(['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'].map(id =>
    [id, { supportsThinking: true, supportedEfforts: ['minimal', ...levels], defaultEffort: 'minimal', mandatory: true }])),
  'gemini-3.1-pro-preview': { supportsThinking: true, supportedEfforts: levels, defaultEffort: 'high', mandatory: true },
  'gemini-3-flash-preview': { supportsThinking: true, supportedEfforts: ['minimal', ...levels], defaultEffort: 'high', mandatory: true },
  'gemini-3-pro-preview': { supportsThinking: true, supportedEfforts: ['low', 'high'], defaultEffort: 'high', mandatory: true },
  'gemini-2.5-pro': { supportsThinking: true, supportedEfforts: [], mandatory: true, supportsMaxTokens: true, thinkingBudget: { min: 128, max: 32768, dynamic: true, canDisable: false } },
  'gemini-2.5-flash': { supportsThinking: true, supportedEfforts: [], defaultEnabled: true, supportsMaxTokens: true, thinkingBudget: { min: 0, max: 24576, dynamic: true, canDisable: true } },
  'gemini-2.5-flash-lite': { supportsThinking: true, supportedEfforts: [], defaultEnabled: false, supportsMaxTokens: true, thinkingBudget: { min: 512, max: 24576, dynamic: true, canDisable: true } },
}
export function getGeminiReasoningCapabilities(model: string): ModelReasoningCapabilities | undefined {
  return contracts[model.trim().replace(/^models\//u, '').toLowerCase()]
}

// https://ai.google.dev/gemini-api/docs/generate-content/priority-inference
// The same published model set supports /generate-content/flex-inference.
const priority = new Set(['gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.6-flash',
  'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.1-pro-preview', 'gemini-3-flash-preview',
  'gemini-3-pro-image-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-image', 'gemini-2.5-flash-lite'])
export function supportsGeminiServiceTier(model: string): boolean {
  return priority.has(model.trim().replace(/^models\//u, '').toLowerCase())
}
