import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { getInitialSettings } from '../settings/settings.js'

export type APIProvider =
  | 'firstParty'
  | 'bedrock'
  | 'vertex'
  | 'foundry'
  | 'ollama'

export function getAPIProvider(): APIProvider {
  const activeProvider = getInitialSettings().provider?.active
  if (!activeProvider || activeProvider === 'ollama') {
    return 'ollama'
  }
  // External provider adapters are not first-party URHQ API deployments. Use
  // the existing non-first-party branch to avoid Ollama-only code without
  // enabling first-party-only headers, betas, or model defaults.
  return 'foundry'
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
