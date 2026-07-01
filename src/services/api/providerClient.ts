// @ts-nocheck
/**
 * Provider-aware LLM runtime dispatch.
 *
 * Authentication and provider setup live elsewhere. This module only resolves
 * the selected provider/model pair, validates that the pair is scoped to the
 * provider, and creates the backend client for that provider.
 */

import type URHQ from '@urhq-ai/sdk'
import type { MessageParam } from '@urhq-ai/sdk/resources/index.mjs'
import {
  formatInvalidProviderModelMessage,
  getActiveProviderSettings,
  getDefaultModelForProvider,
  getProviderAccessTypeLabel,
  getProviderDefinition,
  getProviderRuntimeBackend,
  getValidModelIdsForProvider,
  resolveProviderId,
  validateProviderModelPair,
  type ProviderId,
} from '../providers/providerRegistry.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import type { SettingsJson } from '../../utils/settings/types.js'

export type ProviderRuntimeSelection = {
  providerId: ProviderId
  providerName: string
  accessType: string
  accessTypeLabel: string
  credentialType: string
  model: string
  modelSelectionSource: 'requested' | 'configured' | 'default'
  runtimeBackend: string
}

export type ProviderClientOptions = {
  apiKey?: string
  maxRetries?: number
  model?: string
  signal?: AbortSignal
  fetchOverride?: ConstructorParameters<typeof URHQ>[0]['fetch']
  source?: string
}

export function resolveActiveProviderModel(
  options: {
    settings?: SettingsJson
    model?: string
    source?: string
  } = {},
): ProviderRuntimeSelection {
  const settings = options.settings ?? getInitialSettings()
  const providerSettings = getActiveProviderSettings(settings)
  const providerId = providerSettings.active ?? 'ollama'
  const provider = getProviderDefinition(providerId)
  if (!provider) {
    throw new Error(
      `Provider "${providerId}" is selected, but no runtime provider is registered. Run: ur provider list`,
    )
  }

  const configuredModel = providerSettings.model
  const defaultModel = getDefaultModelForProvider(providerId)
  const model = options.model ?? configuredModel ?? defaultModel
  const modelSelectionSource = options.model
    ? 'requested'
    : configuredModel
      ? 'configured'
      : 'default'

  if (!model) {
    throw new Error(
      `Provider "${providerId}" is selected, but no model is selected or discoverable. Run /model and choose a model from ${providerId}.`,
    )
  }

  const validation = validateProviderModelPair(providerId, model, {
    // Preserve the legacy first-run Ollama path when no explicit provider.model
    // has been saved yet. Explicit saved pairs stay strict.
    allowUncachedDynamic: providerId === 'ollama' && !configuredModel,
  })
  if (validation.valid === false) {
    throw new Error(
      formatRuntimeDispatchError({
        providerId,
        model,
        why: validation.error,
        validModels: validation.validModels,
        suggestedModel: validation.suggestedModel,
      }),
    )
  }

  return {
    providerId,
    providerName: provider.displayName,
    accessType: provider.accessType,
    accessTypeLabel: getProviderAccessTypeLabel(provider),
    credentialType: provider.credentialType,
    model,
    modelSelectionSource,
    runtimeBackend: getProviderRuntimeBackend(providerId),
  }
}

export function formatRuntimeDispatchError({
  providerId,
  model,
  why,
  validModels,
  suggestedModel,
}: {
  providerId: ProviderId | string
  model: string
  why: string
  validModels?: string[]
  suggestedModel?: string
}): string {
  const provider = resolveProviderId(providerId) ?? String(providerId)
  const valid =
    validModels?.length
      ? validModels.join(', ')
      : getValidModelIdsForProvider(provider).join(', ') || '(no models discovered)'
  const suggestion =
    suggestedModel ??
    getDefaultModelForProvider(provider) ??
    '<valid-model>'
  return `Provider "${provider}" is selected with model "${model}", but runtime dispatch cannot use that provider/model pair. Reason: ${why}. Valid models for ${provider}: ${valid}. Run /model and choose a model from ${provider}, or run: ur config set model ${suggestion}`
}

export async function createProviderClient(
  providerId: ProviderId | string,
  options: ProviderClientOptions = {},
): Promise<URHQ> {
  const resolved = resolveProviderId(providerId)
  if (!resolved) {
    throw new Error(`Unknown provider: ${providerId}`)
  }
  const provider = getProviderDefinition(resolved)

  let client: URHQ
  switch (provider.accessType) {
    case 'local':
      client = await createLocalProviderClient(resolved, options)
      break
    case 'server':
      client = await createOpenAICompatibleProviderClient(resolved, options)
      break
    case 'subscription':
      client = await createSubscriptionClient(resolved, options)
      break
    case 'api':
      if (provider.endpointKind === 'openai-compatible') {
        client = await createOpenAICompatibleProviderClient(resolved, options)
      } else {
        client = await createAPIClient(resolved, options)
      }
      break
    default:
      throw new Error(`Unsupported provider access type: ${provider.accessType}`)
  }

  return tagClient(client, resolved)
}

function tagClient(client: URHQ, providerId: ProviderId): URHQ {
  Object.defineProperties(client as object, {
    __urProviderId: { value: providerId, enumerable: false },
    __urRuntimeBackend: {
      value: getProviderRuntimeBackend(providerId),
      enumerable: false,
    },
  })
  return client
}

async function createLocalProviderClient(
  providerId: ProviderId,
  options: ProviderClientOptions = {},
): Promise<URHQ> {
  if (providerId !== 'ollama') {
    throw new Error(
      `Provider "${providerId}" is not an Ollama runtime. Runtime backend is ${getProviderRuntimeBackend(providerId)}.`,
    )
  }
  const { createOllamaURHQClient } = await import('./ollama.js')
  return createOllamaURHQClient() as URHQ
}

async function createOpenAICompatibleProviderClient(
  providerId: ProviderId,
  options: ProviderClientOptions = {},
): Promise<URHQ> {
  const settings = getInitialSettings()
  const providerSettings = getActiveProviderSettings(settings)
  const provider = getProviderDefinition(providerId)
  const baseUrl =
    providerSettings.active === providerId
      ? providerSettings.baseUrl ?? provider.defaultBaseUrl
      : provider.defaultBaseUrl
  if (!baseUrl) {
    throw new Error(
      `Provider "${providerId}" requires a base URL. Run: ur config set base_url <url>`,
    )
  }
  const apiKey =
    options.apiKey ??
    (provider.envKey ? process.env[provider.envKey] : undefined)
  const { createOpenAICompatibleClient } = await import('./openaiCompatible.js')
  return createOpenAICompatibleClient({
    baseUrl,
    apiKey,
    maxRetries: options.maxRetries ?? 3,
  }) as URHQ
}

async function createSubscriptionClient(
  providerId: ProviderId,
  options: ProviderClientOptions = {},
): Promise<URHQ> {
  const provider = getProviderDefinition(providerId)
  const settings = getInitialSettings()
  const providerSettings = getActiveProviderSettings(settings)
  const { which } = await import('../../utils/which.js')
  let commandPath = providerSettings.commandPath ?? null
  if (!commandPath) {
    for (const candidate of provider.commandCandidates ?? []) {
      commandPath = await which(candidate)
      if (commandPath) break
    }
  }
  if (!commandPath) {
    throw new Error(
      `Provider "${providerId}" is selected with model "${options.model ?? providerSettings.model ?? 'unknown'}", but runtime backend "${getProviderRuntimeBackend(providerId)}" is unavailable. Official CLI not found. Tried: ${provider.commandCandidates?.join(', ') || providerId}. Run: ur provider doctor ${providerId}`,
    )
  }
  const { createURHQSubscriptionClient } = await import('./urhqSubscription.js')
  return createURHQSubscriptionClient(providerId, {
    commandPath,
    maxRetries: options.maxRetries ?? 3,
    model: options.model,
  }) as URHQ
}

async function createAPIClient(
  providerId: ProviderId,
  options: ProviderClientOptions = {},
): Promise<URHQ> {
  const provider = getProviderDefinition(providerId)
  const settings = getInitialSettings()
  const providerSettings = getActiveProviderSettings(settings)
  const apiKey = options.apiKey ?? process.env[provider.envKey ?? '']

  if (provider.envKey && !apiKey) {
    throw new Error(
      `Provider "${providerId}" is selected with model "${options.model ?? providerSettings.model ?? 'unknown'}", but runtime backend "${getProviderRuntimeBackend(providerId)}" is unavailable. API key ${provider.envKey} is not set. Run: ur provider doctor ${providerId}`,
    )
  }

  if (providerId === 'openrouter') {
    const { createOpenRouterClient } = await import('./openrouter.js')
    return createOpenRouterClient({
      apiKey,
      maxRetries: options.maxRetries ?? 3,
      model: options.model,
    }) as URHQ
  }

  const { createStandardAPIClient } = await import('./standardAPI.js')
  return createStandardAPIClient({
    providerId,
    apiKey,
    baseUrl:
      providerSettings.active === providerId
        ? providerSettings.baseUrl ?? provider.defaultBaseUrl
        : provider.defaultBaseUrl,
    maxRetries: options.maxRetries ?? 3,
    model: options.model,
  }) as URHQ
}

export async function getActiveProviderClient(
  options: ProviderClientOptions = {},
): Promise<URHQ> {
  const runtime = resolveActiveProviderModel({ model: options.model })
  return createProviderClient(runtime.providerId, {
    ...options,
    model: runtime.model,
  })
}

export async function validateProviderRuntime(
  providerId: ProviderId | string,
): Promise<{ ok: true; runtimeBackend: string } | { ok: false; error: string }> {
  const resolved = resolveProviderId(providerId)
  if (!resolved) {
    return { ok: false, error: `Unknown provider: ${providerId}` }
  }
  const provider = getProviderDefinition(resolved)
  const settings = getInitialSettings()
  const providerSettings = getActiveProviderSettings(settings)
  const scopedBaseUrl =
    providerSettings.active === resolved ? providerSettings.baseUrl : undefined

  switch (provider.accessType) {
    case 'local':
    case 'server':
      if (!(scopedBaseUrl ?? provider.defaultBaseUrl)) {
        return { ok: false, error: `No base URL configured for ${resolved}` }
      }
      return { ok: true, runtimeBackend: getProviderRuntimeBackend(resolved) }
    case 'subscription': {
      const { which } = await import('../../utils/which.js')
      if (providerSettings.commandPath) {
        return { ok: true, runtimeBackend: getProviderRuntimeBackend(resolved) }
      }
      for (const candidate of provider.commandCandidates ?? []) {
        if (await which(candidate)) {
          return { ok: true, runtimeBackend: getProviderRuntimeBackend(resolved) }
        }
      }
      return {
        ok: false,
        error: `${resolved} CLI not found. Tried: ${provider.commandCandidates?.join(', ')}`,
      }
    }
    case 'api':
      if (provider.endpointKind === 'openai-compatible') {
        if (!(scopedBaseUrl ?? provider.defaultBaseUrl)) {
          return { ok: false, error: `No base URL configured for ${resolved}` }
        }
        return { ok: true, runtimeBackend: getProviderRuntimeBackend(resolved) }
      }
      if (
        provider.envKey &&
        !process.env[provider.envKey]
      ) {
        return { ok: false, error: `API key ${provider.envKey} not set` }
      }
      return { ok: true, runtimeBackend: getProviderRuntimeBackend(resolved) }
    default:
      return { ok: false, error: `Unsupported provider type: ${provider.accessType}` }
  }
}

type RuntimeRequestOptions = {
  maxRetries?: number
  signal?: AbortSignal
  request?: Record<string, unknown>
  clientFactory?: typeof createProviderClient
}

export async function sendModelRequest(
  providerId: ProviderId | string,
  model: string,
  messages: MessageParam[],
  options: RuntimeRequestOptions = {},
) {
  const runtime = resolveProviderRuntimePair(providerId, model)
  const client = await (options.clientFactory ?? createProviderClient)(
    runtime.providerId,
    { maxRetries: options.maxRetries, model: runtime.model, signal: options.signal },
  )
  return client.beta.messages.create(
    {
      model: runtime.model,
      messages,
      max_tokens: options.request?.max_tokens ?? 1024,
      stream: false,
      ...(options.request ?? {}),
    },
    { signal: options.signal },
  )
}

export async function streamModelResponse(
  providerId: ProviderId | string,
  model: string,
  messages: MessageParam[],
  options: RuntimeRequestOptions = {},
) {
  const runtime = resolveProviderRuntimePair(providerId, model)
  const client = await (options.clientFactory ?? createProviderClient)(
    runtime.providerId,
    { maxRetries: options.maxRetries, model: runtime.model, signal: options.signal },
  )
  return client.beta.messages
    .create(
      {
        model: runtime.model,
        messages,
        max_tokens: options.request?.max_tokens ?? 1024,
        stream: true,
        ...(options.request ?? {}),
      },
      { signal: options.signal },
    )
    .withResponse()
}

function resolveProviderRuntimePair(
  providerId: ProviderId | string,
  model: string,
): ProviderRuntimeSelection {
  const provider = resolveProviderId(providerId)
  if (!provider) {
    throw new Error(`Unknown provider "${providerId}". Run: ur provider list`)
  }
  const validation = validateProviderModelPair(provider, model)
  if (validation.valid === false) {
    throw new Error(
      formatRuntimeDispatchError({
        providerId: provider,
        model,
        why: validation.error,
        validModels: validation.validModels,
        suggestedModel: validation.suggestedModel,
      }),
    )
  }
  const definition = getProviderDefinition(provider)
  return {
    providerId: provider,
    providerName: definition.displayName,
    accessType: definition.accessType,
    accessTypeLabel: getProviderAccessTypeLabel(definition),
    credentialType: definition.credentialType,
    model,
    modelSelectionSource: 'requested',
    runtimeBackend: getProviderRuntimeBackend(provider),
  }
}
