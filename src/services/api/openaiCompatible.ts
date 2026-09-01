/**
 * OpenAI-compatible client for local/server providers.
 * Supports LM Studio, llama.cpp, vLLM, and other compatible endpoints.
 */

import { randomUUID } from 'crypto'
import { synthesizeKimiToolCalls } from '../../cli/transports/kimiToolCalls.js'
import {
  type EffortLevel,
  getProviderEffortWireValue,
  toOpenRouterReasoningEffort,
} from '../../utils/effort.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  getProviderReasoningCapabilitiesForModel,
  markProviderModelUnavailable,
  resolveProviderId,
  type OpenRouterSettings,
} from '../providers/providerRegistry.js'
import { normalizeOpenAIChatUsage } from './usageNormalization.js'
import {
  assertUniqueToolNames,
  assertValidToolName,
  prepareAndValidateToolSchema,
  ToolSchemaValidationError,
  validateOpenAIStrictToolSchema,
} from './toolSchema.js'
import {
  assertValidProviderToolUses,
  isProviderToolInput,
  ProviderCapabilityError,
  ProviderResponseParseError,
} from './providerClient.js'
import {
  createOpenAISSEMessageStream,
  mergeAbortSignals,
} from './streamingAdapters.js'
import {
  fetchWithProviderReliability,
  normalizeOpenAICompatibleBaseUrl,
} from './providerHttp.js'
import {
  collectOpenRouterUrlCitations,
  formatOpenRouterCitations,
} from './openRouterCitations.js'

type URHQClient = {
  beta: { messages: any }
}

const TOKEN_COUNT_TIMEOUT_MS = 10_000

type NormalizedImageSource =
  | {
    type: 'base64'
    mediaType: string
    data: string
  }
  | {
    type: 'url'
    url: string
    mediaType?: string
  }

export async function createOpenAICompatibleClient(
  options: {
    baseUrl: string
    apiKey?: string
    maxRetries?: number
    providerId?: string
    fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  },
): Promise<URHQClient> {
  const endpoint = normalizeOpenAICompatibleBaseUrl(options.baseUrl)
  const maxRetries = options.maxRetries
  const providerId = options.providerId ?? 'openai-compatible'

  const isUnavailableNvidiaFunction = (response: Response, body: string): boolean =>
    providerId === 'nvidia-nim' &&
    response.status === 404 &&
    /function\s+['"][^'"]+['"]\s*:\s*not found for account\s+['"][^'"]+['"]/iu.test(body)

  const failureMessage = (
    response: Response,
    body: string,
    streaming: boolean,
    model: unknown,
  ): string => {
    if (isUnavailableNvidiaFunction(response, body)) {
      const modelId = typeof model === 'string' && model.trim()
        ? model.trim()
        : 'selected model'
      markProviderModelUnavailable(providerId, modelId, options.baseUrl)
      return `NVIDIA NIM model "${modelId}" is not active for this account. UR removed it from this session's catalog; run /model and choose an account-active NVIDIA model.`
    }
    return `OpenAI-compatible${streaming ? ' streaming' : ''} request failed for ${endpoint} (${response.status}): ${body || response.statusText}`
  }

  const failureBody = (response: Response, body: string): string | undefined =>
    isUnavailableNvidiaFunction(response, body) ? undefined : body

  async function doRequest(params: any, requestOptions?: any) {
    const response = await fetchWithProviderReliability(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(options.apiKey
            ? { Authorization: `Bearer ${options.apiKey}` }
            : {}),
          ...(requestOptions?.headers ?? {}),
        },
        body: JSON.stringify(toOpenAICompatibleRequest(params, providerId)),
      },
      {
        fetch: options.fetch,
        maxRetries,
        timeoutMs: requestOptions?.timeoutMs,
        signal: requestOptions?.signal,
        failureMessage: (response, body) =>
          failureMessage(response, body, false, params.model),
        failureBody,
      },
    )

    const data = await response.json()
    return {
      response,
      data: parseOpenAICompatibleResponse(data, params.model),
    }
  }

  async function doStream(params: any, requestOptions?: any, controller?: AbortController) {
    const streamController = controller ?? new AbortController()
    const signal = mergeAbortSignals([requestOptions?.signal, streamController.signal])
    const response = await fetchWithProviderReliability(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(options.apiKey
            ? { Authorization: `Bearer ${options.apiKey}` }
            : {}),
          ...(requestOptions?.headers ?? {}),
        },
        body: JSON.stringify(
          toOpenAICompatibleRequest({ ...params, stream: true }, providerId),
        ),
      },
      {
        fetch: options.fetch,
        maxRetries,
        timeoutMs: requestOptions?.timeoutMs,
        signal,
        streaming: true,
        failureMessage: (response, body) =>
          failureMessage(response, body, true, params.model),
        failureBody,
      },
    )

    const requestId =
      response.headers.get('x-request-id') ??
      response.headers.get('x-request-id'.toLowerCase()) ??
      `openai-compatible-${randomUUID()}`
    return {
      response,
      requestId,
      data: createOpenAISSEMessageStream(response.body, {
        controller: streamController,
        signal,
        model: params.model,
        requestId,
        providerName: 'openai-compatible',
      }),
    }
  }

  return {
    beta: {
      messages: {
        create(params: any, requestOptions?: any) {
          if (params.stream) {
            const controller = new AbortController()
            const requestPromise = doStream(params, requestOptions, controller)
            return {
              async withResponse() {
                const { response, data, requestId } = await requestPromise
                return {
                  data,
                  response,
                  request_id: requestId,
                }
              },
              controller,
            }
          }
          return doRequest(params, requestOptions).then(({ data }) => data)
        },
        async countTokens(params: any, requestOptions?: any) {
          const estimate = () => {
            const translated = toOpenAICompatibleRequest(params, providerId)
            return {
              input_tokens: estimateSerializedInputTokens({
                messages: translated.messages ?? [],
                tools: translated.tools ?? [],
              }),
              source: 'local-estimate' as const,
            }
          }
          if (
            providerId !== 'llama.cpp' &&
            providerId !== 'vllm' &&
            providerId !== 'nvidia-nim'
          ) {
            return estimate()
          }

          try {
            const openAIRequest = toOpenAICompatibleRequest(params, providerId)
            const url = providerId === 'llama.cpp'
              ? `${endpoint.replace(/\/$/u, '')}/input_tokens`
              : openAICompatibleAnthropicCountUrl(endpoint)
            const body = providerId === 'llama.cpp'
              ? openAIRequest
              : {
                  model: params.model,
                  messages: params.messages?.length
                    ? params.messages
                    : [{ role: 'user', content: 'count' }],
                  ...(params.system !== undefined ? { system: params.system } : {}),
                  ...(params.tools?.length ? { tools: params.tools } : {}),
                  ...(params.thinking !== undefined
                    ? { thinking: params.thinking }
                    : {}),
                }
            const response = await fetchWithProviderReliability(
              url,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(options.apiKey
                    ? { Authorization: `Bearer ${options.apiKey}` }
                    : {}),
                  ...(requestOptions?.headers ?? {}),
                },
                body: JSON.stringify(body),
              },
              {
                fetch: options.fetch,
                maxRetries,
                timeoutMs: requestOptions?.timeoutMs ?? TOKEN_COUNT_TIMEOUT_MS,
                signal: requestOptions?.signal,
                failureMessage: (failedResponse, responseBody) =>
                  `${providerId} token-count request failed (${failedResponse.status}): ${responseBody || failedResponse.statusText}`,
              },
            )
            const result = await response.json() as Record<string, unknown>
            if (
              typeof result.input_tokens !== 'number' ||
              !Number.isFinite(result.input_tokens) ||
              result.input_tokens < 0
            ) {
              throw new Error(`${providerId} token-count response omitted input_tokens.`)
            }
            return {
              input_tokens: Math.floor(result.input_tokens),
              source: 'provider' as const,
            }
          } catch (error) {
            logForDebugging(
              `[token-count] ${providerId} native count unavailable; using a provider-wire estimate: ${error instanceof Error ? error.message : String(error)}`,
            )
            return estimate()
          }
        },
      },
    },
  } as URHQClient
}

function openAICompatibleAnthropicCountUrl(chatEndpoint: string): string {
  const url = new URL(chatEndpoint)
  url.hash = ''
  url.search = ''
  url.pathname = url.pathname.replace(
    /\/chat\/completions\/?$/u,
    '/messages/count_tokens',
  )
  return url.toString().replace(/\/$/u, '')
}

export function toOpenAICompatibleRequest(
  params: any,
  providerName = 'openai-compatible',
  options: { openrouter?: OpenRouterSettings } = {},
): any {
  const tools = toOpenAITools(params.tools, providerName)
  const responseFormat = toOpenAIResponseFormat(params.output_config?.format)
  const reasoningEffort = toOpenAIReasoningEffort(params, providerName)
  const openRouterWireEffort =
    providerName === 'openrouter' && reasoningEffort
      ? toOpenRouterReasoningEffort(String(params.model ?? ''), reasoningEffort)
      : undefined
  const openRouterReasoning =
    providerName === 'openrouter'
      ? toOpenRouterReasoning(params, openRouterWireEffort)
      : undefined
  const compatibleReasoningEffort =
    reasoningEffort && providerName !== 'openrouter'
      ? (() => {
          const provider = resolveProviderId(providerName)
          const advertisedWireValue = provider
            ? getProviderEffortWireValue(
                String(params.model ?? ''),
                reasoningEffort,
                provider,
              )
            : undefined
          // Normal requests arrive here after the session resolver has
          // capability-gated the selected level. Translate any explicit
          // provider alias (for example vLLM minimal→none). Ultra is the one
          // selector that may never pass through without an advertised wire
          // equivalent.
          return advertisedWireValue ??
            (reasoningEffort === 'ultra' ? undefined : reasoningEffort)
        })()
      : undefined
  const openRouterServerSearch =
    providerName === 'openrouter' &&
    tools.some(tool => tool?.type === 'openrouter:web_search')
  const toolChoice = openRouterServerSearch
    ? undefined
    : mapOpenAIToolChoice(params.tool_choice)
  const openRouterProviderPreferences =
    providerName === 'openrouter'
      ? openRouterRoutingPreferences(params, options.openrouter)
      : undefined
  const openRouterSessionId =
    providerName === 'openrouter'
      ? resolveOpenRouterSessionId(params)
      : undefined
  const openRouterServiceTier =
    providerName === 'openrouter'
      ? params.service_tier ?? options.openrouter?.serviceTier
      : undefined
  const openRouterSpeed =
    providerName === 'openrouter'
      ? params.speed ?? options.openrouter?.speed
      : undefined
  const nvidiaCodingAgentTemplate =
    providerName === 'nvidia-nim' &&
    /^nvidia\/nemotron-3-(?:super|ultra)(?:-|$)/iu.test(String(params.model ?? '')) &&
    tools.length > 0
      ? { force_nonempty_content: true }
      : undefined
  return {
    model: params.model,
    messages: toOpenAIMessages(params, providerName),
    // Unsloth Studio can execute server-side web/code tools by default. UR is
    // the sole tool runtime for this provider integration: Unsloth performs
    // inference only, while every tool call stays inside UR's permission,
    // sandbox, provenance, and verifier boundary.
    ...(providerName === 'unsloth' ? { enable_tools: false } : {}),
    max_tokens: params.max_tokens,
    ...(params.temperature !== undefined && { temperature: params.temperature }),
    ...(params.top_p !== undefined && { top_p: params.top_p }),
    ...(params.stop_sequences?.length > 0 && { stop: params.stop_sequences }),
    ...(params.metadata !== undefined && { metadata: params.metadata }),
    ...(openRouterReasoning
      ? { reasoning: openRouterReasoning }
      : compatibleReasoningEffort
        ? { reasoning_effort: compatibleReasoningEffort }
        : {}),
    ...(responseFormat && { response_format: responseFormat }),
    ...(openRouterProviderPreferences && {
      provider: openRouterProviderPreferences,
    }),
    ...(openRouterSessionId && { session_id: openRouterSessionId }),
    ...(openRouterServiceTier && openRouterServiceTier !== 'auto'
      ? { service_tier: openRouterServiceTier }
      : {}),
    ...(openRouterSpeed === 'fast' ? { speed: 'fast' } : {}),
    ...(nvidiaCodingAgentTemplate && {
      chat_template_kwargs: nvidiaCodingAgentTemplate,
    }),
    stream: Boolean(params.stream),
    // OpenRouter now always includes usage in its final streaming chunk; its
    // former `usage.include` and `stream_options.include_usage` switches are
    // deprecated no-ops. Other OpenAI-compatible servers still use the latter.
    ...(params.stream && providerName !== 'openrouter'
      ? { stream_options: { include_usage: true } }
      : {}),
    ...(tools.length > 0 ? { tools } : {}),
    ...(toolChoice !== undefined ? { tool_choice: toolChoice } : {}),
  }
}

/**
 * Preserve OpenRouter's Auto Exacto routing for tool turns. It combines live
 * throughput with measured tool-call reliability and is bypassed by any
 * explicit sort. Ordinary text turns prioritize total generation throughput,
 * which includes TTFT and streaming time, instead of TTFT alone. Explicit
 * request/config sorting follows OpenRouter precedence; model variants remain
 * authoritative when no conflicting sort was selected.
 */
function openRouterRoutingPreferences(
  params: any,
  settings: OpenRouterSettings | undefined,
): Record<string, unknown> | undefined {
  if (params?.provider && typeof params.provider === 'object' && !Array.isArray(params.provider)) {
    return params.provider as Record<string, unknown>
  }
  const model = typeof params?.model === 'string' ? params.model : ''
  const usesModelRoutingVariant = /:(?:nitro|floor|exacto)$/iu.test(model)

  const preferences: Record<string, unknown> = {}
  const strategy = settings?.routing ?? 'auto'
  const hasTools =
    (Array.isArray(params?.tools) && params.tools.length > 0) ||
    params?.tool_choice !== undefined
  if (strategy !== 'auto') {
    preferences.sort = strategy
  } else if (!usesModelRoutingVariant && !hasTools) {
    preferences.sort = 'throughput'
  }
  if (settings?.allowFallbacks !== undefined) {
    preferences.allow_fallbacks = settings.allowFallbacks
  }
  if (settings?.requireParameters !== undefined) {
    preferences.require_parameters = settings.requireParameters
  }
  if (settings?.preferredMinThroughput !== undefined) {
    preferences.preferred_min_throughput = settings.preferredMinThroughput
  }
  if (settings?.preferredMaxLatency !== undefined) {
    preferences.preferred_max_latency = settings.preferredMaxLatency
  }
  return Object.keys(preferences).length > 0 ? preferences : undefined
}

/**
 * OpenRouter's session_id keeps an agent conversation on the same upstream
 * endpoint, allowing provider prompt caches to stay warm across tool turns.
 * UR already puts its stable session id inside metadata.user_id; promote that
 * value to the provider-native field without introducing another identifier.
 */
function resolveOpenRouterSessionId(params: any): string | undefined {
  const explicit = validOpenRouterSessionId(params?.session_id)
  if (explicit) return explicit
  const encodedMetadata = params?.metadata?.user_id
  if (typeof encodedMetadata !== 'string') return undefined
  try {
    return validOpenRouterSessionId(JSON.parse(encodedMetadata)?.session_id)
  } catch {
    return undefined
  }
}

function validOpenRouterSessionId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= 256 ? trimmed : undefined
}

function toOpenAIResponseFormat(format: any): any | undefined {
  if (format?.type !== 'json_schema' || !format.schema) return undefined
  return {
    type: 'json_schema',
    json_schema: {
      name: typeof format.name === 'string' && format.name ? format.name : 'ur_response',
      schema: format.schema,
      strict: format.strict !== false,
    },
  }
}

function toOpenAIReasoningEffort(
  params: any,
  providerName: string,
): EffortLevel | undefined {
  const requested = params.output_config?.effort
  if (
    requested === 'minimal' ||
    requested === 'low' ||
    requested === 'medium' ||
    requested === 'high' ||
    requested === 'xhigh' ||
    requested === 'max'
  ) {
    return requested
  }
  if (requested === 'ultra') {
    const provider = resolveProviderId(providerName)
    if (!provider) return undefined
    return getProviderEffortWireValue(
      String(params.model ?? ''),
      'ultra',
      provider,
    )
      ? 'ultra'
      : undefined
  }
  // There is no cross-server boolean reasoning control in the generic
  // OpenAI-compatible contract. OpenRouter publishes a model-scoped contract;
  // other adapters send an effort only when UR resolved one explicitly above.
  if (providerName !== 'openrouter') return undefined
  const capabilities = getProviderReasoningCapabilitiesForModel(
    String(params.model ?? ''),
    'openrouter',
  )
  const advertisesGradedEffort =
    capabilities?.supportedEfforts === null ||
    (Array.isArray(capabilities?.supportedEfforts) &&
      capabilities.supportedEfforts.length > 0)
  if (!advertisesGradedEffort) return undefined
  if (params.thinking?.type === 'adaptive') return 'medium'
  if (params.thinking?.type !== 'enabled') return undefined
  const budget = Number(params.thinking.budget_tokens ?? 0)
  if (budget > 0 && budget <= 4_000) return 'low'
  if (budget >= 16_000) return 'high'
  return 'medium'
}

function toOpenRouterReasoning(
  params: any,
  wireEffort: string | undefined,
): Record<string, unknown> | undefined {
  if (wireEffort) return { effort: wireEffort }
  if (
    params.thinking?.type !== 'enabled' &&
    params.thinking?.type !== 'adaptive'
  ) {
    return undefined
  }
  const capabilities = getProviderReasoningCapabilitiesForModel(
    String(params.model ?? ''),
    'openrouter',
  )
  if (!capabilities || capabilities.supportsThinking === false) return undefined
  const advertisesReasoning =
    capabilities.supportsThinking === true ||
    capabilities.supportedEfforts !== undefined ||
    capabilities.defaultEffort !== undefined ||
    capabilities.defaultEnabled !== undefined ||
    capabilities.mandatory !== undefined ||
    capabilities.supportsMaxTokens === true
  if (!advertisesReasoning) return undefined
  const budget = Number(params.thinking?.budget_tokens ?? 0)
  if (
    capabilities.supportsMaxTokens === true &&
    Number.isFinite(budget) &&
    budget > 0
  ) {
    return { max_tokens: Math.floor(budget) }
  }
  // OpenRouter's documented provider-default control is the only safe choice
  // when a model advertises reasoning but no graded effort vocabulary.
  return { enabled: true }
}

export function estimateProviderInputTokens(params: any): number {
  return estimateSerializedInputTokens({
    system: params.system ?? null,
    messages: params.messages ?? [],
    tools: params.tools ?? [],
  })
}

/** Conservative tokenizer-independent estimate of an already translated wire payload. */
export function estimateSerializedInputTokens(value: unknown): number {
  const serialized = JSON.stringify(value) ?? ''
  return Math.max(1, Math.ceil(serialized.length / 4))
}

export function toOpenAIMessages(params: any, providerName = 'openai-compatible'): any[] {
  const messages: any[] = []
  const system = systemToOpenAIContent(params.system, providerName)
  if (typeof system === 'string' ? system.length > 0 : system.length > 0) {
    messages.push({ role: 'system', content: system })
  }
  const toolNamesById = collectToolNamesById(params.messages)
  for (const message of params.messages ?? []) {
    messages.push(...messageToOpenAIMessages(message, toolNamesById, providerName))
  }
  return messages
}

function systemToOpenAIContent(system: any, providerName: string): string | any[] {
  const text = systemToText(system, providerName)
  if (providerName !== 'openrouter' || !Array.isArray(system)) return text
  const blocks = system.flatMap(block => {
    if (typeof block?.text !== 'string') return []
    const cacheControl = toOpenRouterCacheControl(block.cache_control)
    return [{
      type: 'text',
      text: block.text,
      ...(cacheControl && { cache_control: cacheControl }),
    }]
  })
  return blocks.some(block => block.cache_control) ? blocks : text
}

function toOpenRouterCacheControl(
  value: unknown,
): { type: 'ephemeral'; ttl?: '1h' } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const cache = value as Record<string, unknown>
  if (cache.type !== 'ephemeral') return undefined
  return {
    type: 'ephemeral',
    ...(cache.ttl === '1h' ? { ttl: '1h' as const } : {}),
  }
}

export function systemToText(system: any, providerName = 'provider'): string {
  if (!system) return ''
  assertNoImageBlocks(system, providerName, 'system content')
  if (typeof system === 'string') return system
  if (Array.isArray(system)) {
    return system.map(block => block?.text ?? '').join('\n\n')
  }
  return ''
}

export function contentToText(content: any): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap(block => {
      if (typeof block === 'string') return [block]
      if (block?.type === 'text') return [block.text ?? '']
      if (block?.type === 'tool_result') return [contentToText(block.content)]
      return []
    })
    .join('\n')
}

export function assertNoImageBlocks(
  content: any,
  providerName: string,
  context: string,
): void {
  if (!containsImageBlock(content)) return
  throw new ProviderCapabilityError(
    `${providerName} does not support image content in ${context}`,
    { providerName, capability: 'multimodal_input', context },
  )
}

export function containsImageBlock(content: any): boolean {
  if (!Array.isArray(content)) return false
  return content.some(block => {
    if (block?.type === 'image') return true
    if (block?.type === 'tool_result') return containsImageBlock(block.content)
    return false
  })
}

export function imageBlocksFromContent(content: any): any[] {
  if (!Array.isArray(content)) return []
  return content.flatMap(block => {
    if (block?.type === 'image') return [block]
    if (block?.type === 'tool_result') {
      return imageBlocksFromContent(block.content)
    }
    return []
  })
}

export function normalizeImageBlockSource(
  block: any,
  providerName: string,
  context: string,
): NormalizedImageSource {
  if (block?.type !== 'image') {
    throw new ProviderCapabilityError(
      `${providerName} expected an image block in ${context}`,
      { providerName, capability: 'multimodal_input', context, block },
    )
  }
  const source = block.source
  if (!source || typeof source !== 'object') {
    throw new ProviderCapabilityError(
      `${providerName} received an image block without a source in ${context}`,
      { providerName, capability: 'multimodal_input', context, block },
    )
  }

  if (source.type === 'base64') {
    const mediaType = source.media_type ?? source.mediaType
    if (typeof mediaType !== 'string' || mediaType.length === 0) {
      throw new ProviderCapabilityError(
        `${providerName} image block in ${context} is missing media_type`,
        { providerName, capability: 'multimodal_input', context, block },
      )
    }
    if (typeof source.data !== 'string' || source.data.length === 0) {
      throw new ProviderCapabilityError(
        `${providerName} image block in ${context} is missing base64 data`,
        { providerName, capability: 'multimodal_input', context, block },
      )
    }
    return {
      type: 'base64',
      mediaType,
      data: source.data,
    }
  }

  if (source.type === 'url') {
    if (typeof source.url !== 'string' || source.url.length === 0) {
      throw new ProviderCapabilityError(
        `${providerName} image block in ${context} is missing a URL`,
        { providerName, capability: 'multimodal_input', context, block },
      )
    }
    const mediaType = source.media_type ?? source.mediaType
    return {
      type: 'url',
      url: source.url,
      ...(typeof mediaType === 'string' && mediaType.length > 0
        ? { mediaType }
        : {}),
    }
  }

  throw new ProviderCapabilityError(
    `${providerName} does not support image source type "${String(source.type)}" in ${context}`,
    { providerName, capability: 'multimodal_input', context, block },
  )
}

export function imageBlockToOpenAIContentPart(
  block: any,
  providerName: string,
  context: string,
): any {
  const source = normalizeImageBlockSource(block, providerName, context)
  const url =
    source.type === 'base64'
      ? `data:${source.mediaType};base64,${source.data}`
      : source.url
  return {
    type: 'image_url',
    image_url: { url },
  }
}

export function toOpenAITools(tools: any, providerName = 'OpenAI'): any[] {
  if (tools === undefined || tools === null) return []
  if (!Array.isArray(tools)) {
    throw new ToolSchemaValidationError(`${providerName} tools must be an array.`)
  }
  const result = tools.map(tool => toOpenAITool(tool, providerName))
  assertUniqueToolNames(
    result
      .filter(tool => tool?.type === 'function')
      .map(tool => tool.function.name),
    providerName,
  )
  return result
}

export function mapOpenAIToolChoice(toolChoice: any): any {
  if (toolChoice === undefined || toolChoice === null) return undefined
  if (typeof toolChoice === 'string') {
    return toolChoice === 'any' ? 'required' : toolChoice
  }
  if (toolChoice.type === 'function') {
    return toolChoice
  }
  switch (toolChoice.type) {
    case 'auto':
      return 'auto'
    case 'any':
      return 'required'
    case 'none':
      return 'none'
    case 'tool':
      if (typeof toolChoice.name !== 'string' || toolChoice.name.length === 0) {
        throw new Error('Invalid tool_choice: Anthropic tool choice requires a tool name')
      }
      return { type: 'function', function: { name: toolChoice.name } }
    default:
      return toolChoice
  }
}

export function parseOpenAICompatibleResponse(
  data: any,
  fallbackModel: string,
  providerName = 'openai-compatible',
): any {
  if (data?.error) {
    throw new ProviderResponseParseError(
      `${providerName} returned an error payload: ${typeof data.error?.message === 'string' ? data.error.message : JSON.stringify(data.error)}`,
      { data },
    )
  }
  const choice = data.choices?.[0]
  if (!choice) {
    throw new ProviderResponseParseError(`${providerName} response did not include a choice`, { data })
  }
  const content = parseOpenAIMessageContent(
    choice?.message,
    choice?.text,
    providerName,
  )
  // Recover a tool call the model wrote as text instead of emitting through
  // the structured interface. This repair already ran for Ollama and the
  // remote transport but never here, so the same model reached through an
  // OpenAI-compatible endpoint or OpenRouter had the call silently dropped and
  // the turn did nothing. Only applied when the response carries no real tool
  // call, so a model that used the interface correctly is never second-guessed.
  if (!hasToolUse(content)) {
    synthesizeKimiToolCalls({ message: { content } })
  }
  const includesToolUse = hasToolUse(content)
  assertValidProviderToolUses(content, `${providerName} response`)
  if (isOpenAIToolStopReason(choice?.finish_reason) && !includesToolUse) {
    throw new ProviderResponseParseError(
      `${providerName} response finished with ${choice?.finish_reason} but did not include a tool call`,
      { choice },
    )
  }
  return {
    id: data.id ?? `${providerName}-${randomUUID()}`,
    type: 'message',
    role: 'assistant',
    model: data.model ?? fallbackModel,
    content,
    stop_reason: mapOpenAIStopReason(choice?.finish_reason, includesToolUse),
    stop_sequence: null,
    // Cached and reasoning token details were previously dropped, and the
    // cached prefix would otherwise be counted twice — see usageNormalization.
    usage: normalizeOpenAIChatUsage(data.usage),
  }
}

export function mapOpenAIStopReason(reason: string | undefined, includesToolUse = false): string {
  if (includesToolUse || isOpenAIToolStopReason(reason)) {
    return 'tool_use'
  }
  switch (reason) {
    case 'length':
      return 'max_tokens'
    case 'stop':
    case 'end':
    case 'end_turn':
    case undefined:
      return 'end_turn'
    default:
      return 'end_turn'
  }
}

function isOpenAIToolStopReason(reason: string | undefined): boolean {
  return reason === 'tool_calls' || reason === 'function_call' || reason === 'tool_use'
}

function toOpenAITool(tool: any, providerName: string): any {
  if (providerName === 'openrouter' && tool?.type === 'web_search_20250305') {
    return {
      type: 'openrouter:web_search',
      parameters: {
        ...(Number.isInteger(tool.max_uses) && tool.max_uses > 0
          ? { max_uses: tool.max_uses }
          : {}),
        ...(Array.isArray(tool.allowed_domains) && tool.allowed_domains.length > 0
          ? { allowed_domains: tool.allowed_domains }
          : {}),
        ...(Array.isArray(tool.blocked_domains) && tool.blocked_domains.length > 0
          ? { excluded_domains: tool.blocked_domains }
          : {}),
      },
    }
  }
  if (
    tool?.type === 'function' &&
    tool.function
  ) {
    assertValidToolName(tool.function.name, providerName)
    const strict = tool.function.strict === true
    return {
      type: 'function',
      function: {
        name: tool.function.name,
        ...(tool.function.description !== undefined && {
          description: tool.function.description,
        }),
        parameters: prepareAndValidateToolSchema(
          tool.function.parameters,
          tool.function.name,
          'json-schema',
          { openAIStrict: strict },
        ),
        ...(strict && { strict: true }),
      },
    }
  }
  if (!tool || typeof tool !== 'object' || !('input_schema' in tool)) {
    throw new ToolSchemaValidationError(
      `${providerName} tool entry is missing required name/input_schema fields.`,
    )
  }
  assertValidToolName(tool.name, providerName)
  const parameters = prepareAndValidateToolSchema(
    tool.input_schema,
    tool.name,
    'json-schema',
  )
  // `strict` on the internal tool shape is a capability preference, not an
  // assertion that every generated schema already satisfies OpenAI's stricter
  // all-properties-required contract. Keep the valid tool available in normal
  // function mode when optional fields make strict mode inapplicable. An
  // explicit OpenAI function-shaped strict definition above still fails
  // clearly if its declared contract is malformed.
  const strict =
    tool.strict === true && validateOpenAIStrictToolSchema(parameters).length === 0
  return {
    type: 'function',
    function: {
      name: tool.name,
      ...(tool.description !== undefined && { description: tool.description }),
      parameters,
      ...(strict && { strict: true }),
    },
  }
}

function collectToolNamesById(messages: any): Map<string, string> {
  const names = new Map<string, string>()
  for (const message of messages ?? []) {
    if (!Array.isArray(message?.content)) continue
    for (const block of message.content) {
      if (
        block?.type === 'tool_use' &&
        typeof block.id === 'string' &&
        typeof block.name === 'string'
      ) {
        names.set(block.id, block.name)
      }
    }
  }
  return names
}

function messageToOpenAIMessages(
  message: any,
  toolNamesById: Map<string, string>,
  providerName: string,
): any[] {
  const content = message?.content
  if (typeof content === 'string') {
    return [{ role: message.role, content }]
  }
  if (!Array.isArray(content)) {
    return [{ role: message.role, content: '' }]
  }

  const textParts: string[] = []
  const multimodalParts: any[] = []
  let pendingTextParts: Array<{
    text: string
    cacheControl?: { type: 'ephemeral'; ttl?: '1h' }
  }> = []
  let hasStructuredContent = false
  const toolCalls: any[] = []
  const toolResults: any[] = []
  const toolResultImageParts: any[] = []
  const flushTextPart = () => {
    if (pendingTextParts.length === 0) return
    if (pendingTextParts.some(part => part.cacheControl)) {
      hasStructuredContent = true
      for (const part of pendingTextParts) {
        if (part.text.length === 0) continue
        multimodalParts.push({
          type: 'text',
          text: part.text,
          ...(part.cacheControl && { cache_control: part.cacheControl }),
        })
      }
    } else {
      const text = pendingTextParts.map(part => part.text).join('\n')
      if (text.length > 0) {
        multimodalParts.push({ type: 'text', text })
      }
    }
    pendingTextParts = []
  }

  for (const [index, block] of content.entries()) {
    if (typeof block === 'string') {
      textParts.push(block)
      pendingTextParts.push({ text: block })
      continue
    }
    switch (block?.type) {
      case 'text':
        textParts.push(block.text ?? '')
        pendingTextParts.push({
          text: block.text ?? '',
          ...(providerName === 'openrouter' &&
          toOpenRouterCacheControl(block.cache_control)
            ? { cacheControl: toOpenRouterCacheControl(block.cache_control) }
            : {}),
        })
        break
      case 'image':
        flushTextPart()
        multimodalParts.push(
          imageBlockToOpenAIContentPart(
            block,
            providerName,
            `messages[].content[${index}]`,
          ),
        )
        hasStructuredContent = true
        break
      case 'tool_use':
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          },
        })
        break
      case 'tool_result':
        const toolResultImages = imageBlocksFromContent(block.content)
        const toolResultCacheControl =
          providerName === 'openrouter'
            ? toOpenRouterCacheControl(block.cache_control)
            : undefined
        const toolResultText = contentToText(block.content)
        const toolResultName =
          toolNamesById.get(block.tool_use_id) ?? block.tool_use_id ?? index
        toolResults.push({
          role: 'tool',
          tool_call_id: block.tool_use_id,
          content: toolResultCacheControl
            ? [{
                type: 'text',
                text: toolResultText,
                cache_control: toolResultCacheControl,
              }]
            : toolResultText,
          ...(toolNamesById.get(block.tool_use_id)
            ? { name: toolNamesById.get(block.tool_use_id) }
            : {}),
        })
        if (toolResultImages.length > 0) {
          // Chat Completions tool messages accept textual function output,
          // while multimodal input belongs in a user message. Keep the tool
          // result paired with its call, then carry every byte in an adjacent
          // user turn. This is accepted by OpenRouter/OpenAI-compatible vision
          // models and never silently discards a screenshot.
          toolResultImageParts.push({
            type: 'text',
            text: `Image output from tool ${toolResultName}:`,
          })
          toolResultImageParts.push(
            ...toolResultImages.map((image, imageIndex) =>
              imageBlockToOpenAIContentPart(
                image,
                providerName,
                `tool_result ${block.tool_use_id ?? index} image ${imageIndex}`,
              ),
            ),
          )
        }
        break
      default:
        break
    }
  }

  const text = textParts.join('\n')
  flushTextPart()
  const messageContent = hasStructuredContent ? multimodalParts : text
  if (message.role === 'assistant' && toolCalls.length > 0) {
    return [
      {
        role: 'assistant',
        content: hasStructuredContent ? messageContent : text || null,
        tool_calls: toolCalls,
      },
    ]
  }

  if (toolResults.length > 0) {
    // OpenAI-compatible APIs require tool messages immediately after the
    // assistant tool_calls they answer. Any sibling user text/images follow
    // those results, including images lifted out of a tool_result above.
    const result: any[] = [...toolResults]
    if (toolResultImageParts.length > 0) {
      const followupParts = hasStructuredContent
        ? [...multimodalParts]
        : text
          ? [{ type: 'text', text }]
          : []
      followupParts.push(...toolResultImageParts)
      result.push({ role: 'user', content: followupParts })
    } else if (hasStructuredContent) {
      result.push({ role: message.role, content: messageContent })
    } else if (text) {
      result.push({ role: message.role, content: text })
    }
    return result
  }

  return [{ role: message.role, content: messageContent }]
}

function parseOpenAIMessageContent(
  message: any,
  legacyText: unknown,
  providerName: string,
): any[] {
  const content: any[] = []
  const reasoning =
    typeof message?.reasoning_content === 'string'
      ? message.reasoning_content
      : typeof message?.reasoning === 'string'
        ? message.reasoning
        : ''
  if (reasoning.length > 0) {
    content.push({ type: 'thinking', thinking: reasoning })
  }
  const citationText = formatOpenRouterCitations(
    collectOpenRouterUrlCitations(message?.annotations),
  )
  const text = openAIMessageText(message?.content, legacyText) + citationText
  if (text.length > 0) {
    content.push({ type: 'text', text })
  }

  const toolCalls = parseOpenAIToolCalls(
    message?.tool_calls,
    `${providerName} choices[0].message.tool_calls`,
  )
  content.push(...toolCalls)

  if (message?.function_call !== undefined) {
    content.push(
      parseLegacyOpenAIFunctionCall(
        message.function_call,
        `${providerName} choices[0].message.function_call`,
      ),
    )
  }

  return content.length > 0 ? content : [{ type: 'text', text: '' }]
}

function openAIMessageText(content: unknown, legacyText: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(block => {
        if (typeof block === 'string') return block
        if (block?.type === 'text') return block.text ?? ''
        return ''
      })
      .join('')
  }
  if (typeof legacyText === 'string') return legacyText
  return ''
}

function parseOpenAIToolCalls(toolCalls: unknown, path: string): any[] {
  if (toolCalls === undefined || toolCalls === null) return []
  if (!Array.isArray(toolCalls)) {
    throw new ProviderResponseParseError(`${path} must be an array`, { toolCalls })
  }
  return toolCalls.map((toolCall, index) =>
    parseOpenAIToolCall(toolCall, `${path}[${index}]`),
  )
}

function parseOpenAIToolCall(toolCall: any, path: string): any {
  if (toolCall?.type !== undefined && toolCall.type !== 'function') {
    throw new ProviderResponseParseError(`${path} has unsupported tool call type`, {
      toolCall,
    })
  }
  if (typeof toolCall?.id !== 'string' || toolCall.id.length === 0) {
    throw new ProviderResponseParseError(`${path} is missing a tool call id`, {
      toolCall,
    })
  }
  const fn = toolCall.function
  if (typeof fn?.name !== 'string' || fn.name.length === 0) {
    throw new ProviderResponseParseError(`${path}.function.name is required`, {
      toolCall,
    })
  }
  return {
    type: 'tool_use',
    id: toolCall.id,
    name: fn.name,
    input: parseToolArguments(fn.arguments, `${path}.function.arguments`),
  }
}

function parseLegacyOpenAIFunctionCall(functionCall: any, path: string): any {
  if (typeof functionCall?.name !== 'string' || functionCall.name.length === 0) {
    throw new ProviderResponseParseError(`${path}.name is required`, { functionCall })
  }
  return {
    type: 'tool_use',
    id: `function_call_${randomUUID()}`,
    name: functionCall.name,
    input: parseToolArguments(functionCall.arguments, `${path}.arguments`),
  }
}

function parseToolArguments(args: unknown, path: string): unknown {
  if (args === undefined || args === null || args === '') return {}
  if (typeof args !== 'string') {
    if (!isProviderToolInput(args)) {
      throw new ProviderResponseParseError(`${path} must be a JSON object`, {
        args,
      })
    }
    return args
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(args)
  } catch (error) {
    throw new ProviderResponseParseError(`${path} is not valid JSON`, {
      args,
      cause: error,
    })
  }
  if (!isProviderToolInput(parsed)) {
    throw new ProviderResponseParseError(`${path} must decode to a JSON object`, {
      args,
    })
  }
  return parsed
}

function hasToolUse(content: any[]): boolean {
  return content.some(block => block?.type === 'tool_use')
}

// Delegates to the shared preparation pass: strips meta and vendor keys at
// every depth (not just the root) and inlines local $ref targets that most
// providers cannot resolve. See services/api/toolSchema.ts.
