import {
  createProviderClient,
  type ProviderMessageClient,
  type ProviderClientOptions,
  resolveActiveProviderModel,
} from './providerClient.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import type { ProviderSettings } from '../providers/providerRegistry.js'

/**
 * Get a URHQ-compatible client configured for the selected provider/model pair.
 *
 * This is the production entry point used by query dispatch. It must not
 * silently fall back to Ollama or any other provider; provider fallback is only
 * allowed inside model discovery for the same selected provider.
 */
export async function getURHQClient({
  apiKey,
  maxRetries,
  model,
  fetchOverride,
  source,
  providerSettings,
}: {
  apiKey?: string
  maxRetries: number
  model?: string
  fetchOverride?: ProviderClientOptions['fetchOverride']
  source?: string
  providerSettings?: Readonly<ProviderSettings>
}): Promise<ProviderMessageClient> {
  const settings: SettingsJson | undefined = providerSettings
    ? ({
        ...getInitialSettings(),
        provider: {
          ...providerSettings,
          ...(providerSettings.responses
            ? { responses: { ...providerSettings.responses } }
            : {}),
        },
      } as SettingsJson)
    : undefined
  const runtime = resolveActiveProviderModel({ settings, model, source })
  return createProviderClient(runtime.providerId, {
    apiKey,
    maxRetries,
    model: runtime.model,
    fetchOverride,
    source,
    settings,
  })
}

export const CLIENT_REQUEST_ID_HEADER = 'x-client-request-id'
