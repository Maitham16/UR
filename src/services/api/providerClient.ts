// @ts-nocheck
/**
 * Provider-aware LLM client factory.
 *
 * This module routes model requests to the correct backend based on the
 * selected provider. Each provider has its own client implementation:
 * - Subscription CLI providers (codex-cli, claude-code-cli, etc.)
 * - API providers (openai-api, anthropic-api, etc.)
 * - Local providers (ollama, lmstudio, llama.cpp, vllm)
 *
 * Provider authentication already works - this module only handles routing.
 */

import type URHQ from '@urhq-ai/sdk'
import {
  getActiveProviderSettings,
  getProviderDefinition,
  type ProviderId,
} from '../providers/providerRegistry.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import { getAPIProvider } from '../../utils/model/providers.js'

/**
 * Create a URHQ-compatible client for the specified provider.
 *
 * @param providerId - The provider to create a client for
 * @param options - Client configuration options
 * @returns A URHQ-compatible client instance
 */
export async function createProviderClient(
  providerId: ProviderId,
  options: {
    maxRetries?: number
    model?: string
    signal?: AbortSignal
  } = {},
): Promise<URHQ> {
  const provider = getProviderDefinition(providerId)
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`)
  }

  // Route to appropriate client based on provider type
  switch (provider.accessType) {
    case 'local':
      // Local providers use Ollama-compatible API
      return createLocalProviderClient(providerId, options)

    case 'subscription':
      // Subscription CLI providers spawn the official CLI
      return createSubscriptionClient(providerId, options)

    case 'api':
      // API providers use direct HTTP API calls
      return createAPIClient(providerId, options)

    default:
      throw new Error(`Unsupported provider access type: ${provider.accessType}`)
  }
}

/**
 * Create a client for local providers (Ollama, LM Studio, llama.cpp, vLLM).
 * These all use OpenAI-compatible APIs.
 */
async function createLocalProviderClient(
  providerId: ProviderId,
  options: { maxRetries?: number; model?: string } = {},
): Promise<URHQ> {
  // Ollama has a specialized client
  if (providerId === 'ollama') {
    const { createOllamaURHQClient } = await import('./ollama.js')
    return createOllamaURHQClient() as URHQ
  }

  // Other local providers (LM Studio, llama.cpp, vLLM) use OpenAI-compatible endpoints
  const settings = getInitialSettings()
  const providerSettings = getActiveProviderSettings(settings)
  const provider = getProviderDefinition(providerId)
  const baseUrl = providerSettings.baseUrl ?? provider.defaultBaseUrl

  if (!baseUrl) {
    throw new Error(
      `No base URL configured for provider ${providerId}. ` +
      `Run: ur config set base_url <url>`
    )
  }

  const { createOpenAICompatibleClient } = await import('./openaiCompatible.js')
  return createOpenAICompatibleClient({
    baseUrl,
    apiKey: providerSettings.baseUrl ? undefined : 'not-needed',
    maxRetries: options.maxRetries ?? 3,
  }) as URHQ
}

/**
 * Create a client for subscription CLI providers.
 * These spawn the official CLI commands.
 */
async function createSubscriptionClient(
  providerId: ProviderId,
  options: { maxRetries?: number; model?: string } = {},
): Promise<URHQ> {
  // For now, route through the URHQ abstraction which handles CLI spawning
  // Each subscription provider has its own implementation
  const { createURHQSubscriptionClient } = await import('./urhqSubscription.js')
  return createURHQSubscriptionClient(providerId, options) as URHQ
}

/**
 * Create a client for API providers.
 * These make direct HTTP API calls.
 */
async function createAPIClient(
  providerId: ProviderId,
  options: { maxRetries?: number; model?: string } = {},
): Promise<URHQ> {
  const provider = getProviderDefinition(providerId)
  const settings = getInitialSettings()
  const providerSettings = getActiveProviderSettings(settings)

  // OpenRouter has special handling
  if (providerId === 'openrouter') {
    const { createOpenRouterClient } = await import('./openrouter.js')
    return createOpenRouterClient({
      maxRetries: options.maxRetries ?? 3,
      model: options.model,
    }) as URHQ
  }

  // Standard API providers (OpenAI, Anthropic, Gemini)
  const apiKey = process.env[provider.envKey ?? '']
  if (!apiKey && provider.envKey) {
    throw new Error(
      `API key not found. Set ${provider.envKey} in your environment. ` +
      `Provider ${providerId} requires API key authentication.`
    )
  }

  const { createStandardAPIClient } = await import('./standardAPI.js')
  return createStandardAPIClient({
    providerId,
    apiKey,
    baseUrl: providerSettings.baseUrl ?? provider.defaultBaseUrl,
    maxRetries: options.maxRetries ?? 3,
  }) as URHQ
}

/**
 * Get the active provider client based on current configuration.
 * This is the main entry point used by the runtime.
 */
export async function getActiveProviderClient(
  options: {
    maxRetries?: number
    model?: string
    signal?: AbortSignal
  } = {},
): Promise<URHQ> {
  const settings = getInitialSettings()
  const providerSettings = getActiveProviderSettings(settings)
  const providerId = providerSettings.active ?? 'ollama'

  return createProviderClient(providerId, options)
}

/**
 * Validate that a provider is ready for runtime use.
 * Returns an error message if not ready, or null if ready.
 */
export async function validateProviderRuntime(
  providerId: ProviderId,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const provider = getProviderDefinition(providerId)
  if (!provider) {
    return {
      ok: false,
      error: `Unknown provider: ${providerId}`,
    }
  }

  const settings = getInitialSettings()
  const providerSettings = getActiveProviderSettings(settings)

  // Check based on provider type
  switch (provider.accessType) {
    case 'local':
      // Check if local endpoint is reachable
      const baseUrl = providerSettings.baseUrl ?? provider.defaultBaseUrl
      if (!baseUrl) {
        return {
          ok: false,
          error: `No base URL configured for ${providerId}`,
        }
      }
      // Could ping the endpoint here, but keep it lightweight
      return { ok: true }

    case 'subscription':
      // Check if CLI is installed
      const { which } = await import('../../utils/which.js')
      const commandPath = providerSettings.commandPath
      if (commandPath) {
        return { ok: true }
      }
      const found = await Promise.any(
        (provider.commandCandidates ?? []).map(cmd => which(cmd)),
      )
      if (!found) {
        return {
          ok: false,
          error: `${providerId} CLI not found. Tried: ${provider.commandCandidates?.join(', ')}`,
        }
      }
      return { ok: true }

    case 'api':
      // Check if API key is present
      if (provider.envKey && !process.env[provider.envKey]) {
        return {
          ok: false,
          error: `API key ${provider.envKey} not set`,
        }
      }
      return { ok: true }

    default:
      return {
        ok: false,
        error: `Unsupported provider type: ${provider.accessType}`,
      }
  }
}
