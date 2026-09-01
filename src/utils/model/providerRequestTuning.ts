import type { ProviderId } from '../../services/providers/providerRegistry.js'

/**
 * Local and user-hosted runtimes pay the full memory and prefill cost of every
 * reserved token. Cloud APIs can schedule that cost across a fleet; a local
 * GPU cannot. Keep their default reservation realistic while still allowing
 * an explicit UR_CODE_MAX_OUTPUT_TOKENS override.
 */
const CONSERVATIVE_OUTPUT_PROVIDERS = new Set<ProviderId>([
  'ollama',
  'lmstudio',
  'llama.cpp',
  'vllm',
  'unsloth',
  'openai-compatible',
])

export const SELF_HOSTED_DEFAULT_MAX_OUTPUT_TOKENS = 4_096

export function formatOutputTokenLimitMessage(
  model: string,
  requestedMaxTokens: number,
): string {
  return `The provider reported that model "${model}" reached its per-response output boundary on a ${requestedMaxTokens}-token response chunk. This is not a total task-output limit: UR's agent loop continues automatically while the model makes novel progress. UR_CODE_MAX_OUTPUT_TOKENS may change the chunk size up to the model's verified limit.`
}

export function usesConservativeOutputReservation(
  provider: ProviderId,
): boolean {
  return CONSERVATIVE_OUTPUT_PROVIDERS.has(provider)
}
