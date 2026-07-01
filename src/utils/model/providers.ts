import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import {
  getProviderFamily,
  getRuntimeProviderId,
  type ProviderFamily,
  type ProviderId,
} from '../../services/providers/providerRegistry.js'

export type APIProvider =
  | 'firstParty'
  | 'bedrock'
  | 'vertex'
  | 'foundry'
  | 'ollama'

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
