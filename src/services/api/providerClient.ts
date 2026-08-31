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
  ensureProviderModelsFresh,
  getActiveProviderSettings,
  getDefaultModelForProvider,
  getScopedProviderBaseUrl,
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
import { isNetworkRestricted, offlineBlockReason } from '../../utils/offlineMode.js'
import {
  getOllamaBaseUrl,
  getOllamaSessionOverride,
  normalizeOllamaBaseUrl,
} from '../../utils/model/ollamaConfig.js'

export type ProviderMessageClient = {
  beta: {
    messages: {
      create: (
        params: Record<string, unknown>,
        options?: Record<string, unknown>,
      ) => ProviderMessage | ProviderStreamCreateResult | Promise<ProviderMessage>
      countTokens?: (
        params: Record<string, unknown>,
        options?: Record<string, unknown>,
      ) => Promise<{
        input_tokens: number
        /** Whether the provider tokenized the request or UR estimated its wire payload. */
        source?: 'provider' | 'local-estimate'
      }>
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

export function isProviderToolInput(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * All provider families converge on Anthropic-shaped tool_use blocks. Enforce
 * the invariants once at that boundary so malformed calls cannot reach
 * orchestration with duplicate IDs or primitive inputs.
 */
export function assertValidProviderToolUses(
  content: unknown,
  context: string,
): void {
  if (!Array.isArray(content)) {
    throw new ProviderResponseParseError(`${context} content must be an array`, {
      content,
    })
  }
  const ids = new Set<string>()
  for (const [index, block] of content.entries()) {
    if (block?.type !== 'tool_use') continue
    const path = `${context} tool_use[${index}]`
    if (typeof block.id !== 'string' || block.id.length === 0) {
      throw new ProviderResponseParseError(`${path} is missing an id`, {
        block,
      })
    }
    if (ids.has(block.id)) {
      throw new ProviderResponseParseError(
        `${context} contains duplicate tool call id "${block.id}"`,
        { block },
      )
    }
    ids.add(block.id)
    if (typeof block.name !== 'string' || block.name.length === 0) {
      throw new ProviderResponseParseError(`${path} is missing a name`, {
        block,
      })
    }
    if (!isProviderToolInput(block.input)) {
      throw new ProviderResponseParseError(
        `${path} input must be a JSON object`,
        { block },
      )
    }
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
  /** Session-authoritative settings captured with the request. */
  settings?: SettingsJson
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
  const discoveredModels = validModels?.length
    ? validModels
    : getValidModelIdsForProvider(provider)
  const visibleModels = discoveredModels.slice(0, 8)
  const hiddenCount = discoveredModels.length - visibleModels.length
  const valid = discoveredModels.length
    ? `${visibleModels.join(', ')}${hiddenCount > 0 ? `, … and ${hiddenCount} more` : ''}`
    : '(no models discovered)'
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
  assertProviderAllowedOffline(resolved, options.settings ?? getInitialSettings())

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

  await assertFreshRuntimeModel(resolved, options)
  return tagClient(client, resolved)
}

async function assertFreshRuntimeModel(
  providerId: ProviderId,
  options: ProviderClientOptions,
): Promise<void> {
  if (!options.model) return
  const provider = getProviderDefinition(providerId)
  if (provider.modelDiscoveryType !== 'live') return
  const settings = options.settings ?? getInitialSettings()
  const env =
    provider.envKey && options.apiKey
      ? { ...process.env, [provider.envKey]: options.apiKey }
      : process.env
  const discovered = await ensureProviderModelsFresh(providerId, {
    settings,
    adapters: {
      env,
      ...(options.fetchOverride ? { fetch: options.fetchOverride as typeof fetch } : {}),
    },
    signal: options.signal,
  })
  if (discovered.source === 'static' && discovered.warning) {
    throw new Error(
      formatRuntimeDispatchError({
        providerId,
        model: options.model,
        why: `the current provider model list could not be verified: ${discovered.warning}`,
        validModels: discovered.models.map(model => model.id),
      }),
    )
  }
  const validation = validateProviderModelPair(providerId, options.model, {
    availableModels: discovered.models,
    settings,
  })
  if (validation.valid === false) {
    throw new Error(
      formatRuntimeDispatchError({
        providerId,
        model: options.model,
        why: validation.error,
        validModels: validation.validModels,
        suggestedModel: validation.suggestedModel,
      }),
    )
  }
}

function isLoopbackBaseUrl(value: string | undefined): boolean {
  if (!value) return false
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
  } catch {
    return false
  }
}

export function resolveProviderBaseUrl(
  providerId: ProviderId,
  settings: SettingsJson = getInitialSettings(),
): string | undefined {
  const definition = getProviderDefinition(providerId)
  const configuredBaseUrl = getScopedProviderBaseUrl(providerId, settings)
  if (providerId === 'ollama') {
    return normalizeOllamaBaseUrl(
      getOllamaSessionOverride() ??
      configuredBaseUrl ??
      getOllamaBaseUrl(process.env, settings),
    )
  }
  return configuredBaseUrl ?? definition.defaultBaseUrl
}

export function assertProviderAllowedOffline(
  providerId: ProviderId,
  settings: SettingsJson = getInitialSettings(),
): void {
  if (!isNetworkRestricted()) return
  const baseUrl = resolveProviderBaseUrl(providerId, settings)
  const localEndpoint = isLoopbackBaseUrl(baseUrl)
  if (!localEndpoint) throw new Error(offlineBlockReason('cloud-api'))
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
  const settings = options.settings ?? getInitialSettings()
  const baseUrlOverride = resolveProviderBaseUrl(providerId, settings)
  const apiKey = options.apiKey ?? getProviderApiKey(providerId)
  return createOllamaURHQClient({ baseUrlOverride, apiKey }) as ProviderMessageClient
}

async function createOpenAICompatibleProviderClient(
  providerId: ProviderId,
  options: ProviderClientOptions = {},
): Promise<ProviderMessageClient> {
  const settings = options.settings ?? getInitialSettings()
  const providerSettings = getActiveProviderSettings(settings)
  const provider = getProviderDefinition(providerId)
  const baseUrl = resolveProviderBaseUrl(providerId, settings)
  if (!baseUrl) {
    throw new Error(
      `Provider "${providerId}" requires a base URL. Run: ur config set base_url ${providerId} <url>`,
    )
  }
  const apiKey = options.apiKey ?? getProviderApiKey(providerId)
  if (provider.requiresApiKey && !apiKey) {
    throw new Error(
      `Provider "${providerId}" is selected with model "${options.model ?? providerSettings.model ?? 'unknown'}", but it is not connected: no stored API key and ${provider.envKey ?? 'the provider API key'} is not set. Connect once with: ur connect ${providerId}${provider.envKey ? ` (or set ${provider.envKey})` : ''}. Run: ur provider doctor ${providerId}`,
    )
  }
  const { createOpenAICompatibleClient } = await import('./openaiCompatible.js')
  return await createOpenAICompatibleClient({
    baseUrl,
    apiKey,
    maxRetries: options.maxRetries ?? 3,
    providerId,
    fetch: options.fetchOverride,
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
  const settings = options.settings ?? getInitialSettings()
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
  const settings = options.settings ?? getInitialSettings()
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
      baseUrl: resolveProviderBaseUrl(providerId, settings),
      maxRetries: options.maxRetries ?? 3,
      model: options.model,
    }) as ProviderMessageClient
  }

  if (
    providerId === 'openai-api' &&
    providerSettings.active === providerId &&
    providerSettings.openaiTransport === 'responses'
  ) {
    const {
      createOpenAIResponsesClient,
    } = await import('./openaiResponses.js')
    const {
      OpenAIResponsesStateStore,
    } = await import('./openaiResponsesState.js')
    return await createOpenAIResponsesClient({
      apiKey: apiKey!,
      baseUrl: resolveProviderBaseUrl(providerId, settings),
      maxRetries: options.maxRetries ?? 3,
      model: options.model,
      store: providerSettings.responses?.store ?? false,
      compactThreshold: providerSettings.responses?.compactThreshold,
      toolSearch: providerSettings.responses?.toolSearch ?? 'off',
      fetch: options.fetchOverride,
      stateStore: new OpenAIResponsesStateStore(),
    }) as ProviderMessageClient
  }

  const { createStandardAPIClient } = await import('./standardAPI.js')
  return await createStandardAPIClient({
    providerId,
    apiKey,
    baseUrl: resolveProviderBaseUrl(providerId, settings),
    maxRetries: options.maxRetries ?? 3,
    model: options.model,
    fetch: options.fetchOverride,
  }) as ProviderMessageClient
}

export async function getActiveProviderClient(
  options: ProviderClientOptions = {},
): Promise<ProviderMessageClient> {
  const runtime = resolveActiveProviderModel({
    settings: options.settings,
    model: options.model,
  })
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
  const scopedBaseUrl = resolveProviderBaseUrl(resolved, settings)

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
