/**
 * Per-provider credential storage.
 *
 * API keys are stored in UR's existing secure store (macOS Keychain with an
 * encrypted-at-rest file fallback) — the same store used for UR's own OAuth —
 * so a user connects once and the key persists across sessions. At runtime a
 * stored key is preferred, then the provider's environment variable. Nothing is
 * written to plaintext settings and keys are never placed in argv.
 *
 * Subscription providers (Codex, Claude Code, Gemini) do not store keys here;
 * they authenticate through their official CLI login, which persists in that
 * CLI's own credential store.
 */

import { getSecureStorage } from '../../utils/secureStorage/index.js'
import type { SecureStorage } from '../../utils/secureStorage/types.js'
import {
  getProviderDefinition,
  resolveProviderId,
  type ProviderId,
} from './providerRegistry.js'

const STORE_KEY = 'providerCredentials'

type StoredCredential = { apiKey?: string; updatedAt?: string }
type CredentialMap = Record<string, StoredCredential>

/** NVIDIA Agentic and NVIDIA Special intentionally share one Build API key. */
function credentialOwner(provider: ProviderId): ProviderId {
  return provider === 'nvidia-special' ? 'nvidia-nim' : provider
}

export type CredentialOptions = {
  storage?: SecureStorage
  env?: Record<string, string | undefined>
}

function store(options: CredentialOptions): SecureStorage {
  return options.storage ?? getSecureStorage()
}

function readCredentials(storage: SecureStorage): CredentialMap {
  const data = storage.read() ?? {}
  const creds = (data as Record<string, unknown>)[STORE_KEY]
  return creds && typeof creds === 'object' ? { ...(creds as CredentialMap) } : {}
}

function writeCredentials(
  storage: SecureStorage,
  creds: CredentialMap,
): { success: boolean; warning?: string } {
  const data = storage.read() ?? {}
  return storage.update({ ...data, [STORE_KEY]: creds })
}

export function setProviderApiKey(
  providerId: ProviderId | string,
  apiKey: string,
  options: CredentialOptions = {},
): { ok: true; message: string } | { ok: false; message: string } {
  const provider = resolveProviderId(providerId)
  if (!provider) {
    return { ok: false, message: `Unknown provider "${providerId}". Run: ur provider list` }
  }
  const key = apiKey.trim()
  if (!key) {
    return { ok: false, message: 'API key is empty.' }
  }
  const storage = store(options)
  const creds = readCredentials(storage)
  creds[credentialOwner(provider)] = {
    apiKey: key,
    updatedAt: new Date().toISOString(),
  }
  const result = writeCredentials(storage, creds)
  if (!result.success) {
    return { ok: false, message: result.warning ?? 'Failed to store API key.' }
  }
  return { ok: true, message: `Stored API key for ${provider} in ${storage.name}.` }
}

export function getStoredProviderApiKey(
  providerId: ProviderId | string,
  options: CredentialOptions = {},
): string | undefined {
  const provider = resolveProviderId(providerId)
  if (!provider) return undefined
  return readCredentials(store(options))[credentialOwner(provider)]?.apiKey
}

/**
 * Runtime key resolution: stored key first, then the provider's env var.
 */
export function getProviderApiKey(
  providerId: ProviderId | string,
  options: CredentialOptions = {},
): string | undefined {
  const provider = resolveProviderId(providerId)
  if (!provider) return undefined
  const stored = getStoredProviderApiKey(provider, options)
  if (stored) return stored
  const env = options.env ?? process.env
  const envKey = getProviderDefinition(provider).envKey
  return envKey ? env[envKey] : undefined
}

export function hasStoredProviderApiKey(
  providerId: ProviderId | string,
  options: CredentialOptions = {},
): boolean {
  return Boolean(getStoredProviderApiKey(providerId, options))
}

export function clearProviderApiKey(
  providerId: ProviderId | string,
  options: CredentialOptions = {},
): { ok: true; message: string } | { ok: false; message: string } {
  const provider = resolveProviderId(providerId)
  if (!provider) {
    return { ok: false, message: `Unknown provider "${providerId}". Run: ur provider list` }
  }
  const storage = store(options)
  const creds = readCredentials(storage)
  const owner = credentialOwner(provider)
  if (!creds[owner]?.apiKey) {
    return { ok: true, message: `No stored API key for ${provider}.` }
  }
  delete creds[owner]
  const result = writeCredentials(storage, creds)
  if (!result.success) {
    return { ok: false, message: result.warning ?? 'Failed to clear API key.' }
  }
  return { ok: true, message: `Cleared stored API key for ${provider}.` }
}

export type ApiKeySource = 'stored' | 'env' | 'none'

export function getProviderApiKeySource(
  providerId: ProviderId | string,
  options: CredentialOptions = {},
): ApiKeySource {
  const provider = resolveProviderId(providerId)
  if (!provider) return 'none'
  if (getStoredProviderApiKey(provider, options)) return 'stored'
  const env = options.env ?? process.env
  const envKey = getProviderDefinition(provider).envKey
  if (envKey && env[envKey]) return 'env'
  return 'none'
}
