import type { ModelReasoningCapabilities } from './modelCatalog.js'

// Exact documented identities are the fallback when a Models API row omits
// capabilities. Explicit live capabilities remain authoritative.
// https://platform.claude.com/docs/en/build-with-claude/effort
// https://platform.claude.com/docs/en/models/opus-5-5/migration-guide
const fiveLevels = ['low', 'medium', 'high', 'xhigh', 'max']
const adaptive = ['adaptive', 'disabled']
const manual = ['enabled', 'disabled']
const contracts: Record<string, ModelReasoningCapabilities> = {
  'claude-opus-5-5': { supportsThinking: true, supportedEfforts: fiveLevels, defaultEffort: 'medium', defaultEnabled: true, mandatory: true, thinkingTypes: ['adaptive'] },
  'claude-sonnet-5-5': { supportsThinking: true, supportedEfforts: fiveLevels, defaultEffort: 'high', defaultEnabled: true, thinkingTypes: ['adaptive', 'between_tools'] },
  'claude-haiku-5-5': { supportsThinking: true, supportedEfforts: fiveLevels, defaultEffort: 'medium', defaultEnabled: true, thinkingTypes: adaptive },
  'claude-fable-5-1': { supportsThinking: true, supportedEfforts: fiveLevels, defaultEffort: 'high', defaultEnabled: true, mandatory: true, thinkingTypes: ['adaptive'] },
  'claude-fable-5': { supportsThinking: true, supportedEfforts: fiveLevels, defaultEffort: 'high', defaultEnabled: true, mandatory: true, thinkingTypes: ['adaptive'] },
  'claude-opus-5': { supportsThinking: true, supportedEfforts: fiveLevels, defaultEffort: 'high', defaultEnabled: true, thinkingTypes: adaptive },
  'claude-sonnet-5': { supportsThinking: true, supportedEfforts: fiveLevels, defaultEffort: 'high', defaultEnabled: true, thinkingTypes: adaptive },
  'claude-opus-4-8': { supportsThinking: true, supportedEfforts: fiveLevels, defaultEffort: 'high', thinkingTypes: adaptive },
  'claude-opus-4-7': { supportsThinking: true, supportedEfforts: fiveLevels, defaultEffort: 'high', thinkingTypes: adaptive },
  'claude-opus-4-6': { supportsThinking: true, supportedEfforts: ['low', 'medium', 'high', 'max'], defaultEffort: 'high', thinkingTypes: ['adaptive', 'enabled', 'disabled'] },
  'claude-sonnet-4-6': { supportsThinking: true, supportedEfforts: ['low', 'medium', 'high', 'max'], defaultEffort: 'high', thinkingTypes: ['adaptive', 'enabled', 'disabled'] },
  'claude-opus-4-5': { supportsThinking: true, supportedEfforts: ['low', 'medium', 'high'], defaultEffort: 'high', thinkingTypes: manual },
  'claude-sonnet-4-5': { supportsThinking: true, thinkingTypes: manual },
  'claude-haiku-4-5': { supportsThinking: true, thinkingTypes: manual },
}

export function getAnthropicReasoningCapabilities(model: string): ModelReasoningCapabilities | undefined {
  return contracts[model.trim().toLowerCase()]
}

// https://platform.claude.com/docs/en/build-with-claude/fast-mode
export function getAnthropicFastMode(model: string): { beta?: string } | undefined {
  switch (model.trim().toLowerCase()) {
    case 'claude-opus-5-5': return {}
    case 'claude-opus-5':
    case 'claude-opus-4-8': return { beta: 'fast-mode-2026-02-01' }
    default: return undefined
  }
}
