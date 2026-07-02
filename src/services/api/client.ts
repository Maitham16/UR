import {
  createProviderClient,
  type ProviderMessageClient,
  type ProviderClientOptions,
  resolveActiveProviderModel,
} from './providerClient.js'

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
}: {
  apiKey?: string
  maxRetries: number
  model?: string
  fetchOverride?: ProviderClientOptions['fetchOverride']
  source?: string
}): Promise<ProviderMessageClient> {
  const runtime = resolveActiveProviderModel({ model, source })
  return createProviderClient(runtime.providerId, {
    apiKey,
    maxRetries,
    model: runtime.model,
    fetchOverride,
    source,
  })
}

export const CLIENT_REQUEST_ID_HEADER = 'x-client-request-id'
