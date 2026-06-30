import { getSettingsForSource } from '../settings/settings.js'

let sessionOverride: string | undefined

function normalizeOllamaBaseUrl(value: string | undefined): string {
  const base = value?.trim() || 'http://localhost:11434'
  const withScheme = /^https?:\/\//.test(base) ? base : `http://${base}`
  return withScheme.replace(/\/api\/?$/, '').replace(/\/$/, '')
}

/**
 * Resolve the Ollama base URL for this process.
 *
 * Precedence:
 *  1. In-memory session override (set when the user picks a discovered host).
 *  2. `OLLAMA_HOST` environment variable.
 *  3. User settings: `ollama.host`.
 *  4. Fallback `http://localhost:11434`.
 */
export function getOllamaBaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  if (sessionOverride) {
    return normalizeOllamaBaseUrl(sessionOverride)
  }
  const envHost = env.OLLAMA_HOST || env.OLLAMA_BASE_URL
  if (envHost) {
    return normalizeOllamaBaseUrl(envHost)
  }
  const settingsHost = getSettingsForSource('userSettings')?.ollama?.host
  if (settingsHost) {
    return normalizeOllamaBaseUrl(settingsHost)
  }
  return 'http://localhost:11434'
}

/** Set a base URL for the current process only (not persisted). */
export function setOllamaBaseUrlOverride(url: string | undefined): void {
  sessionOverride = url
}

/** Clear the in-memory session override. */
export function clearOllamaBaseUrlOverride(): void {
  sessionOverride = undefined
}
