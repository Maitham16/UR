/**
 * Provider-aware LLM runtime dispatch.
 *
 * Authentication and provider setup live elsewhere. This module only resolves
 * the selected provider/model pair, validates that the pair is scoped to the
 * provider, and creates the backend client for that provider.
 */

import type { MessageParam } from '@urhq-ai/sdk/resources/index.mjs'
import {
  DEFAULT_PROVIDER_ID,
  getActiveProviderSettings,
  getDefaultModelForProvider,
  getProviderAccessTypeLabel,
  getProviderDefinition,
  getProviderRuntimeBlockReason,
  getProviderRuntimeBackend,
  getValidModelIdsForProvider,
  resolveProviderId,
  validateProviderModelPair,
  type ProviderId,
} from '../providers/providerRegistry.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import { getProviderApiKey } from '../providers/providerCredentials.js'

export type ProviderMessageClient = {
  beta: {
    messages: {
      create: (
        params: Record<string, unknown>,
        options?: Record<string, unknown>,
      ) => ProviderMessage | ProviderStreamCreateResult | Promise<ProviderMessage>
      countTokens?: (params: Record<string, unknown>) => Promise<{ input_tokens: number }>
    }
  }
  models?: {
    list: (params?: Record<string, unknown>) => AsyncIterable<unknown> | Iterable<unknown>
  }
}

export type ProviderUsage = {
  input_tokens: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  output_tokens?: number
}

export type ProviderMessage = Record<string, unknown> & {
  withResponse?: () => unknown
  asResponse?: () => Response | Promise<Response>
  usage?: ProviderUsage
}

export type ProviderStreamCreateResult = {
  withResponse: () => Promise<unknown>
  asResponse?: () => Response | Promise<Response>
  usage?: ProviderUsage
  controller?: AbortController
}

export class ProviderResponseParseError extends Error {
  readonly details?: unknown

  constructor(message: string, details?: unknown) {
    super(message)
    this.name = 'ProviderResponseParseError'
    this.details = details
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class ProviderCapabilityError extends Error {
  readonly details?: unknown

  constructor(message: string, details?: unknown) {
    super(message)
    this.name = 'ProviderCapabilityError'
    this.details = details
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

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
  fetchOverride?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
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
  const providerId = providerSettings.active ?? DEFAULT_PROVIDER_ID
  const provider = getProviderDefinition(providerId)
  if (!provider) {
    throw new Error(
      `Provider "${providerId}" is selected, but no runtime provider is registered. Run: ur provider list`,
    )
  }
  const runtimeBlock = getProviderRuntimeBlockReason(providerId)
  if (runtimeBlock) {
    throw new Error(runtimeBlock)
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
    // Live-discovery providers have no static list and their discovered models
    // live in an in-memory cache that is empty on a cold process. The server is
    // the authority, so a saved model can't be disproven before discovery runs:
    // accept it here rather than rejecting a valid saved pair after restart.
    // Static providers stay strict.
    allowUncachedDynamic: provider.modelDiscoveryType === 'live',
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
): Promise<ProviderMessageClient> {
  const resolved = resolveProviderId(providerId)
  if (!resolved) {
    throw new Error(`Unknown provider: ${providerId}`)
  }
  const provider = getProviderDefinition(resolved)
  const runtimeBlock = getProviderRuntimeBlockReason(resolved)
  if (runtimeBlock) {
    throw new Error(runtimeBlock)
  }

  let client: ProviderMessageClient
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

function tagClient(
  client: ProviderMessageClient,
  providerId: ProviderId,
): ProviderMessageClient {
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
): Promise<ProviderMessageClient> {
  if (providerId !== 'ollama') {
    throw new Error(
      `Provider "${providerId}" is not an Ollama runtime. Runtime backend is ${getProviderRuntimeBackend(providerId)}.`,
    )
  }
  const { createOllamaURHQClient } = await import('./ollama.js')
  return createOllamaURHQClient() as ProviderMessageClient
}

async function createOpenAICompatibleProviderClient(
  providerId: ProviderId,
  options: ProviderClientOptions = {},
): Promise<ProviderMessageClient> {
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
    (provider.envKey ? getProviderApiKey(providerId) : undefined)
  const { createOpenAICompatibleClient } = await import('./openaiCompatible.js')
  return await createOpenAICompatibleClient({
    baseUrl,
    apiKey,
    maxRetries: options.maxRetries ?? 3,
  }) as ProviderMessageClient
}

async function createSubscriptionClient(
  providerId: ProviderId,
  options: ProviderClientOptions = {},
): Promise<ProviderMessageClient> {
  const provider = getProviderDefinition(providerId)
  const runtimeBlock = getProviderRuntimeBlockReason(providerId)
  if (runtimeBlock) {
    throw new Error(runtimeBlock)
  }
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
  }) as ProviderMessageClient
}

async function createAPIClient(
  providerId: ProviderId,
  options: ProviderClientOptions = {},
): Promise<ProviderMessageClient> {
  const provider = getProviderDefinition(providerId)
  const settings = getInitialSettings()
  const providerSettings = getActiveProviderSettings(settings)
  const apiKey = options.apiKey ?? getProviderApiKey(providerId)

  if (provider.envKey && !apiKey) {
    throw new Error(
      `Provider "${providerId}" is selected with model "${options.model ?? providerSettings.model ?? 'unknown'}", but it is not connected: no stored API key and ${provider.envKey} is not set. Connect once with: ur connect ${providerId} (or /connect inside UR), or set ${provider.envKey}. Run: ur provider doctor ${providerId}`,
    )
  }

  if (providerId === 'openrouter') {
    const { createOpenRouterClient } = await import('./openrouter.js')
    return await createOpenRouterClient({
      apiKey,
      maxRetries: options.maxRetries ?? 3,
      model: options.model,
    }) as ProviderMessageClient
  }

  const { createStandardAPIClient } = await import('./standardAPI.js')
  return await createStandardAPIClient({
    providerId,
    apiKey,
    baseUrl:
      providerSettings.active === providerId
        ? providerSettings.baseUrl ?? provider.defaultBaseUrl
        : provider.defaultBaseUrl,
    maxRetries: options.maxRetries ?? 3,
    model: options.model,
  }) as ProviderMessageClient
}

export async function getActiveProviderClient(
  options: ProviderClientOptions = {},
): Promise<ProviderMessageClient> {
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
  const runtimeBlock = getProviderRuntimeBlockReason(resolved)
  if (runtimeBlock) {
    return { ok: false, error: runtimeBlock }
  }
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
      if (provider.envKey && !getProviderApiKey(resolved)) {
        return {
          ok: false,
          error: `Not connected: no stored API key and ${provider.envKey} not set. Run: ur connect ${resolved}`,
        }
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
  const result = client.beta.messages.create(
    {
      model: runtime.model,
      messages,
      max_tokens: options.request?.max_tokens ?? 1024,
      stream: true,
      ...(options.request ?? {}),
    },
    { signal: options.signal },
  )
  if (!isProviderStreamCreateResult(result)) {
    throw new Error('Provider stream request did not return a stream response handle.')
  }
  return result.withResponse()
}

function isProviderStreamCreateResult(value: unknown): value is ProviderStreamCreateResult {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'withResponse' in value &&
      typeof (value as { withResponse?: unknown }).withResponse === 'function',
  )
}

function resolveProviderRuntimePair(
  providerId: ProviderId | string,
  model: string,
): ProviderRuntimeSelection {
  const provider = resolveProviderId(providerId)
  if (!provider) {
    throw new Error(`Unknown provider "${providerId}". Run: ur provider list`)
  }
  const runtimeBlock = getProviderRuntimeBlockReason(provider)
  if (runtimeBlock) {
    throw new Error(runtimeBlock)
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
