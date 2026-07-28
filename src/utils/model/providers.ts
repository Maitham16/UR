import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import {
  getProviderFamily,
  getRuntimeProviderId,
  type ProviderFamily,
  type ProviderId,
} from '../../services/providers/providerRegistry.js'

/**
 * Deployment identity used for request shaping.
 *
 * Narrowed to what `getAPIProvider()` can actually return: it maps every
 * provider to 'ollama' or 'foundry' and never yields 'firstParty', 'bedrock'
 * or 'vertex'. Comparisons against those were dead branches that silently
 * disabled advertised features; TypeScript now rejects them.
 */
export type APIProvider = 'foundry' | 'ollama'

/**
 * Keys for legacy per-deployment lookup tables. Those tables are data, not
 * runtime state — they may still carry entries for deployments this build
 * cannot select, and deleting the rows would delete real configuration.
 */
export type DeploymentKey = APIProvider | 'firstParty' | 'bedrock' | 'vertex'

// Real, resolved provider identity. Prefer these over getAPIProvider() when the
// behavior must depend on which provider was actually selected.
export function getRuntimeProvider(): ProviderId {
  return getRuntimeProviderId()
}

export function getRuntimeProviderFamily(): ProviderFamily {
  return getProviderFamily(getRuntimeProviderId())
}

// Legacy deployment enum used by first-party URHQ request shaping (betas, 1M
// context, prompt caching). Derived from the true selected provider: Ollama maps
// to the local branch; every other external provider maps to the generic
// non-first-party branch so first-party-only headers/betas stay disabled.
export function getAPIProvider(): APIProvider {
  return getRuntimeProviderId() === 'ollama' ? 'ollama' : 'foundry'
}

export function isCloudProvider(provider: APIProvider): boolean {
  return provider !== 'ollama'
}

export function getAPIProviderForStatsig(): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

export function isFirstPartyURHQBaseUrl(): boolean {
  return true
}

/**
 * Whether this build runs against the hosted first-party URHQ service.
 *
 * It does not: getAPIProvider() maps every provider to 'ollama' or 'foundry'
 * and can never return 'firstParty'. Sites that used to compare against
 * 'firstParty' were therefore dead branches with misleading conditions —
 * several (fast mode, --effort) silently disabled advertised features. Gate
 * hosted-service-only behavior on this named constant instead, so the intent
 * is readable and greppable rather than hidden in an impossible comparison.
 */
export function isFirstPartyRuntime(): boolean {
  return false
}

/**
 * Whether this build runs against AWS Bedrock. It does not: `getAPIProvider()`
 * cannot return 'bedrock'. Named so Bedrock-only request shaping stays
 * readable and greppable instead of hiding in an impossible comparison.
 */
export function isBedrockRuntime(): boolean {
  return false
}

/**
 * Whether this build runs against Vertex AI. It does not, for the same reason
 * as `isBedrockRuntime`.
 */
export function isVertexRuntime(): boolean {
  return false
}
