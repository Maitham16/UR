/**
 * Unified provider connection status.
 *
 * - API providers: connected when a key is stored (via `ur connect`) or present
 *   in the environment.
 * - Subscription providers: connected when the official CLI reports a logged-in
 *   session (checked through the provider doctor).
 * - Local/server providers: connected when a base URL is configured.
 */

import {
  doctorProvider,
  getActiveProviderSettings,
  getProviderDefinition,
  resolveProviderId,
  type ProviderId,
} from './providerRegistry.js'
import {
  getProviderApiKeySource,
  type ApiKeySource,
  type CredentialOptions,
} from './providerCredentials.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import {
  getOllamaBaseUrl,
  getOllamaSessionOverride,
} from '../../utils/model/ollamaConfig.js'

export type ConnectionState =
  | 'connected'
  | 'needs-key'
  | 'needs-login'
  | 'needs-endpoint'
  | 'unknown'

export type ProviderConnection = {
  provider: ProviderId
  displayName: string
  accessType: string
  state: ConnectionState
  detail: string
  keySource?: ApiKeySource
}

/** Synchronous state for API-key providers (no subprocess) — used by the picker and tests. */
export function getApiConnectionState(
  providerId: ProviderId | string,
  options: CredentialOptions = {},
): { state: ConnectionState; keySource: ApiKeySource } {
  const source = getProviderApiKeySource(providerId, options)
  return { state: source === 'none' ? 'needs-key' : 'connected', keySource: source }
}

export async function getProviderConnection(
  providerId: ProviderId | string,
  options: { credentials?: CredentialOptions } = {},
): Promise<ProviderConnection> {
  const provider = resolveProviderId(providerId)
  if (!provider) {
    throw new Error(`Unknown provider "${providerId}". Run: ur provider list`)
  }
  const def = getProviderDefinition(provider)
  const base = { provider, displayName: def.displayName, accessType: def.accessType }

  if (def.requiresApiKey) {
    const { state, keySource } = getApiConnectionState(provider, options.credentials)
    if (state !== 'connected') {
      return {
        ...base,
        state,
        keySource,
        detail: `run: ur connect ${provider}`,
      }
    }
    const baseUrl = getConfiguredBaseUrl(provider)
    return baseUrl
      ? {
          ...base,
          state: 'connected',
          keySource,
          detail: `${keySource === 'stored' ? 'stored key' : `${def.envKey} in environment`} · endpoint ${baseUrl}`,
        }
      : {
          ...base,
          state: 'needs-endpoint',
          keySource,
          detail: 'no base URL configured',
        }
  }

  if (def.accessType === 'api') {
    const { state, keySource } = getApiConnectionState(provider, options.credentials)
    // OpenAI-compatible endpoints may not require a key; a base URL is enough.
    if (def.endpointKind === 'openai-compatible' && keySource === 'none') {
      const baseUrl = getConfiguredBaseUrl(provider)
      return baseUrl
        ? { ...base, state: 'connected', detail: `endpoint ${baseUrl}`, keySource }
        : { ...base, state: 'needs-endpoint', detail: 'no base URL configured', keySource }
    }
    return {
      ...base,
      state,
      keySource,
      detail:
        state === 'connected'
          ? `${keySource === 'stored' ? 'stored key' : `${def.envKey} in environment`}`
          : `run: ur connect ${provider}`,
    }
  }

  if (def.accessType === 'subscription') {
    const doctor = await doctorProvider(provider)
    return {
      ...base,
      state: doctor.ok ? 'connected' : 'needs-login',
      detail: doctor.ok
        ? 'official CLI logged in'
        : doctor.failureReason ?? `run: ur connect ${provider}`,
    }
  }

  // local / server
  const baseUrl = getConfiguredBaseUrl(provider)
  return baseUrl
    ? { ...base, state: 'connected', detail: `endpoint ${baseUrl}` }
    : { ...base, state: 'needs-endpoint', detail: 'no base URL configured' }
}

export function getConfiguredBaseUrl(provider: ProviderId): string | undefined {
  const allSettings = getInitialSettings()
  const settings = getActiveProviderSettings(allSettings)
  const scoped = settings.active === provider ? settings.baseUrl : undefined
  if (provider === 'ollama') {
    return (
      getOllamaSessionOverride() ??
      scoped ??
      getOllamaBaseUrl(process.env, allSettings)
    )
  }
  return scoped ?? getProviderDefinition(provider).defaultBaseUrl
}

export function formatConnectionLine(conn: ProviderConnection): string {
  const mark = conn.state === 'connected' ? 'connected' : conn.state
  return `${conn.displayName} (${conn.provider}) — ${mark}: ${conn.detail}`
}
