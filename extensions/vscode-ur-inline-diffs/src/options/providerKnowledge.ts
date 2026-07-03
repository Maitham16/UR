// Curated multimodal-support facts. No CLI field exposes this anywhere in
// the backend, so this is the single source of truth for both the status
// card and the Agent Options panel — they must never disagree.
//
// - subscription-cli providers: false — image content is rejected before it
//   reaches the external CLI (services/providers/urhqSubscription.ts,
//   ProviderCapabilityError). A confirmed hard "no", not a guess.
// - ur-native cloud APIs: true — current model families accept vision input
//   at the provider level (the specific model chosen still matters).
// - openai-compatible / local runtimes: unknown — endpoint and loaded model
//   are both user-supplied and decided at runtime.

import type { KnownOrUnknown } from '../bridge/types.js'

const MULTIMODAL_TRUE = new Set(['openai-api', 'anthropic-api', 'gemini-api', 'openrouter'])
const MULTIMODAL_FALSE = new Set(['codex-cli', 'claude-code-cli', 'gemini-cli', 'antigravity-cli'])

export function deriveMultimodalSupport(providerId: string): KnownOrUnknown<boolean> {
  if (MULTIMODAL_TRUE.has(providerId)) return true
  if (MULTIMODAL_FALSE.has(providerId)) return false
  return 'unknown'
}
