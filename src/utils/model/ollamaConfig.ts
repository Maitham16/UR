import { getInitialSettings } from '../settings/settings.js'

let sessionOverride: string | undefined

export type OllamaSettingsInput = {
  ollama?: {
    host?: string
    lanDiscovery?: boolean
  }
  provider?: {
    active?: string
    baseUrl?: string
    baseUrls?: Record<string, string | undefined>
  }
}

export function normalizeOllamaBaseUrl(value: string | undefined): string {
  const base = value?.trim() || 'http://localhost:11434'
  const withScheme = /^https?:\/\//.test(base) ? base : `http://${base}`
  return withScheme.replace(/\/api\/?$/, '').replace(/\/$/, '')
}

/** Ollama's hosted API. The OpenAI-compatible layer is /v1, not /api/v1. */
export const OLLAMA_CLOUD_BASE_URL = 'https://ollama.com'

/**
 * Resolve the Ollama base URL for this process.
 *
 * Precedence:
 *  1. In-memory session override (set when the user picks a discovered host).
 *  2. Provider-scoped `provider.baseUrls.ollama` (or its legacy active URL).
 *  3. `OLLAMA_HOST` environment variable.
 *  4. Effective settings: `ollama.host` from user/project/local settings.
 *  5. Ollama's hosted API when `OLLAMA_API_KEY` is set and no host is.
 *  6. Fallback `http://localhost:11434`.
 */
export function getOllamaBaseUrl(
  env: Record<string, string | undefined> = process.env,
  settings?: OllamaSettingsInput,
): string {
  if (sessionOverride) {
    return normalizeOllamaBaseUrl(sessionOverride)
  }
  const effectiveSettings = settings ?? getInitialSettings()
  const scopedProviderHost = effectiveSettings.provider?.baseUrls?.ollama
  const legacyProviderHost =
    effectiveSettings.provider?.baseUrls === undefined &&
    effectiveSettings.provider?.active === 'ollama'
      ? effectiveSettings.provider.baseUrl
      : undefined
  const providerHost = scopedProviderHost ?? legacyProviderHost
  if (providerHost) {
    return normalizeOllamaBaseUrl(providerHost)
  }
  const envHost = env.OLLAMA_HOST || env.OLLAMA_BASE_URL
  if (envHost) {
    return normalizeOllamaBaseUrl(envHost)
  }
  const settingsHost = effectiveSettings.ollama?.host
  if (settingsHost) {
    return normalizeOllamaBaseUrl(settingsHost)
  }
  // With a key but no host, the user means the hosted API: a bare key is
  // useless against localhost, and this is the case that makes Ollama Cloud
  // reachable from CI, where there is no signed-in local daemon to proxy
  // through. An explicit host always wins, so local setups are unaffected.
  if (env.OLLAMA_API_KEY?.trim()) {
    return OLLAMA_CLOUD_BASE_URL
  }
  return 'http://localhost:11434'
}

/** Optional bearer authentication shared by Ollama discovery and inference. */
export function getOllamaAuthHeaders(
  env: Record<string, string | undefined> = process.env,
  apiKeyOverride?: string,
): Record<string, string> {
  const apiKey = apiKeyOverride?.trim() || env.OLLAMA_API_KEY?.trim()
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
}

/** Set a base URL for the current process only (not persisted). */
export function setOllamaBaseUrlOverride(url: string | undefined): void {
  sessionOverride = url
}

/**
 * The host chosen for this session, if any.
 *
 * Exposed because callers that resolve a base URL from provider settings must
 * check this *first*. `--discover-ollama` sets it, but two call sites read
 * `provider.baseUrl` before falling back to `getOllamaBaseUrl()`, so a
 * persisted setting silently outranked a host the user had just picked
 * interactively: `/model` kept listing localhost models and requests kept
 * going to the local daemon.
 */
export function getOllamaSessionOverride(): string | undefined {
  return sessionOverride ? normalizeOllamaBaseUrl(sessionOverride) : undefined
}

/** Clear the in-memory session override. */
export function clearOllamaBaseUrlOverride(): void {
  sessionOverride = undefined
}
