// @ts-nocheck
import type URHQ from '@urhq-ai/sdk'
import { getAPIProvider } from 'src/utils/model/providers.js'
import {
  getActiveProviderSettings,
  getProviderDefinition,
  type ProviderId,
} from '../providers/providerRegistry.js'
import { getInitialSettings } from '../../utils/settings/settings.js'

/**
 * Get a URHQ client configured for the selected provider.
 *
 * This function routes to the appropriate backend based on the
 * currently selected provider in configuration.
 *
 * @param options - Client configuration options
 * @returns A URHQ-compatible client instance
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
  fetchOverride?: ConstructorParameters<typeof URHQ>[0]['fetch']
  source?: string
}): Promise<URHQ> {
  // Get the active provider from configuration
  const settings = getInitialSettings()
  const providerSettings = getActiveProviderSettings(settings)
  const activeProvider = providerSettings.active ?? 'ollama'

  // Validate that the provider is configured correctly
  const provider = getProviderDefinition(activeProvider)
  if (!provider) {
    throw new Error(
      `Provider "${activeProvider}" is not recognized. ` +
      `Run: ur provider list to see available providers.`
    )
  }

  // Route to provider-specific client
  switch (provider.accessType) {
    case 'local':
      // Local providers: Ollama, LM Studio, llama.cpp, vLLM
      return createLocalClient(activeProvider, { maxRetries, model })

    case 'subscription':
      // Subscription CLI providers: codex-cli, claude-code-cli, etc.
      return createSubscriptionClient(activeProvider, { maxRetries, model })

    case 'api':
      // API providers: openai-api, anthropic-api, etc.
      return createAPIClient(activeProvider, { apiKey, maxRetries, model })

    default:
      throw new Error(
        `Unsupported provider access type: ${provider.accessType}. ` +
        `Selected provider: ${activeProvider} (${provider.displayName})`
      )
  }
}

/**
 * Create client for local providers (Ollama, LM Studio, llama.cpp, vLLM).
 */
async function createLocalClient(
  providerId: ProviderId,
  options: { maxRetries: number; model?: string },
): Promise<URHQ> {
  // Ollama has its own specialized client
  if (providerId === 'ollama') {
    const { createOllamaURHQClient } = await import('./ollama.js')
    return createOllamaURHQClient() as URHQ
  }

  // Other local providers use OpenAI-compatible endpoints
  const settings = getInitialSettings()
  const providerSettings = getActiveProviderSettings(settings)
  const provider = getProviderDefinition(providerId)
  const baseUrl = providerSettings.baseUrl ?? provider.defaultBaseUrl

  if (!baseUrl) {
    throw new Error(
      `Provider "${providerId}" requires a base URL. ` +
      `Run: ur config set base_url <url>`
    )
  }

  // Use Ollama-compatible client for LM Studio, llama.cpp, vLLM
  const { createOllamaURHQClient } = await import('./ollama.js')
  const client = await createOllamaURHQClient({ baseUrlOverride: baseUrl })
  return client as URHQ
}

/**
 * Create client for subscription CLI providers.
 * These providers spawn official CLI commands.
 */
async function createSubscriptionClient(
  providerId: ProviderId,
  options: { maxRetries: number; model?: string },
): Promise<URHQ> {
  const provider = getProviderDefinition(providerId)
  const settings = getInitialSettings()
  const providerSettings = getActiveProviderSettings(settings)

  // Check if CLI is available
  const { which } = await import('../../utils/which.js')
  const commandPath = providerSettings.commandPath
  let foundPath: string | null = commandPath ?? null

  if (!foundPath) {
    for (const candidate of provider.commandCandidates ?? []) {
      foundPath = await which(candidate)
      if (foundPath) break
    }
  }

  if (!foundPath) {
    throw new Error(
      `Provider "${providerId}" CLI not found. ` +
      `Tried: ${provider.commandCandidates?.join(', ')}. ` +
      `Install the official CLI and run: ur auth ${getAuthAlias(providerId)}`
    )
  }

  // For subscription providers, use the URHQ wrapper that handles CLI spawning
  // This will be implemented in urhqSubscription.ts
  const { createURHQSubscriptionClient } = await import('./urhqSubscription.js')
  return createURHQSubscriptionClient(providerId, {
    commandPath: foundPath,
    maxRetries: options.maxRetries,
    model: options.model,
  }) as URHQ
}

/**
 * Create client for API providers.
 * These providers use direct HTTP API calls with API keys.
 */
async function createAPIClient(
  providerId: ProviderId,
  options: { apiKey?: string; maxRetries: number; model?: string },
): Promise<URHQ> {
  const provider = getProviderDefinition(providerId)
  const apiKey = options.apiKey ?? process.env[provider.envKey ?? '']

  if (provider.envKey && !apiKey) {
    throw new Error(
      `Provider "${providerId}" requires API key. ` +
      `Set ${provider.envKey} in your environment. ` +
      `Example: export ${provider.envKey}=your-key-here`
    )
  }

  // OpenRouter has special handling
  if (providerId === 'openrouter') {
    const { createOpenRouterClient } = await import('./openrouter.js')
    return createOpenRouterClient({
      apiKey,
      maxRetries: options.maxRetries,
      model: options.model,
    }) as URHQ
  }

  // Standard API providers (OpenAI, Anthropic, Gemini)
  const { createStandardAPIClient } = await import('./standardAPI.js')
  return createStandardAPIClient({
    providerId,
    apiKey,
    maxRetries: options.maxRetries,
    model: options.model,
  }) as URHQ
}

/**
 * Get the auth alias for a provider (for error messages).
 */
function getAuthAlias(providerId: ProviderId): string {
  switch (providerId) {
    case 'codex-cli':
      return 'chatgpt'
    case 'claude-code-cli':
      return 'claude'
    case 'gemini-cli':
      return 'gemini'
    case 'antigravity-cli':
      return 'antigravity'
    default:
      return 'provider'
  }
}

export const CLIENT_REQUEST_ID_HEADER = 'x-client-request-id'
