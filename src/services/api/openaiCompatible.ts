/**
 * OpenAI-compatible client for local/server providers.
 * Supports LM Studio, llama.cpp, vLLM, and other compatible endpoints.
 */

import { randomUUID } from 'crypto'
import { synthesizeKimiToolCalls } from '../../cli/transports/kimiToolCalls.js'
import {
  type EffortLevel,
  toOpenRouterReasoningEffort,
} from '../../utils/effort.js'
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
  },
): Promise<URHQClient> {
  const endpoint = normalizeOpenAICompatibleBaseUrl(options.baseUrl)
  const maxRetries = options.maxRetries
  const providerId = options.providerId ?? 'openai-compatible'

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
        maxRetries,
        timeoutMs: requestOptions?.timeoutMs,
        signal: requestOptions?.signal,
        failureMessage: (response, body) =>
          `OpenAI-compatible request failed for ${endpoint} (${response.status}): ${body || response.statusText}`,
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
        maxRetries,
        timeoutMs: requestOptions?.timeoutMs,
        signal,
        streaming: true,
        failureMessage: (response, body) =>
          `OpenAI-compatible streaming request failed for ${endpoint} (${response.status}): ${body || response.statusText}`,
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
        async countTokens(params: any) {
          return {
            input_tokens: estimateProviderInputTokens(params),
          }
        },
      },
    },
  } as URHQClient
}

export function toOpenAICompatibleRequest(
  params: any,
  providerName = 'openai-compatible',
): any {
  const tools = toOpenAITools(params.tools, providerName)
  const responseFormat = toOpenAIResponseFormat(params.output_config?.format)
  const reasoningEffort = toOpenAIReasoningEffort(params)
  const openRouterReasoning =
    providerName === 'openrouter' && reasoningEffort
      ? {
          effort: toOpenRouterReasoningEffort(
            String(params.model ?? ''),
            reasoningEffort,
          ),
        }
      : undefined
  const compatibleReasoningEffort = reasoningEffort
  const openRouterServerSearch =
    providerName === 'openrouter' &&
    tools.some(tool => tool?.type === 'openrouter:web_search')
  const toolChoice = openRouterServerSearch
    ? undefined
    : mapOpenAIToolChoice(params.tool_choice)
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

function toOpenAIReasoningEffort(params: any): EffortLevel | undefined {
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
  if (params.thinking?.type === 'adaptive') return 'medium'
  if (params.thinking?.type !== 'enabled') return undefined
  const budget = Number(params.thinking.budget_tokens ?? 0)
  if (budget > 0 && budget <= 4_000) return 'low'
  if (budget >= 16_000) return 'high'
  return 'medium'
}

export function estimateProviderInputTokens(params: any): number {
  const serialized = JSON.stringify({
    system: params.system ?? null,
    messages: params.messages ?? [],
    tools: params.tools ?? [],
  })
  return Math.max(1, Math.ceil(serialized.length / 4))
}

export function toOpenAIMessages(params: any, providerName = 'openai-compatible'): any[] {
  const messages: any[] = []
  const system = systemToText(params.system, providerName)
  if (system) {
    messages.push({ role: 'system', content: system })
  }
  const toolNamesById = collectToolNamesById(params.messages)
  for (const message of params.messages ?? []) {
    messages.push(...messageToOpenAIMessages(message, toolNamesById, providerName))
  }
  return messages
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
    .map(block => {
      if (typeof block === 'string') return block
      if (block?.type === 'text') return block.text ?? ''
      if (block?.type === 'tool_result') return contentToText(block.content)
      return ''
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
  let pendingTextParts: string[] = []
  let hasImageContent = false
  const toolCalls: any[] = []
  const toolResults: any[] = []
  const flushTextPart = () => {
    if (pendingTextParts.length === 0) return
    const text = pendingTextParts.join('\n')
    if (text.length > 0) {
      multimodalParts.push({ type: 'text', text })
    }
    pendingTextParts = []
  }

  for (const [index, block] of content.entries()) {
    if (typeof block === 'string') {
      textParts.push(block)
      pendingTextParts.push(block)
      continue
    }
    switch (block?.type) {
      case 'text':
        textParts.push(block.text ?? '')
        pendingTextParts.push(block.text ?? '')
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
        hasImageContent = true
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
        assertNoImageBlocks(
          block.content,
          providerName,
          `tool_result ${block.tool_use_id ?? index} content`,
        )
        toolResults.push({
          role: 'tool',
          tool_call_id: block.tool_use_id,
          content: contentToText(block.content),
          ...(toolNamesById.get(block.tool_use_id)
            ? { name: toolNamesById.get(block.tool_use_id) }
            : {}),
        })
        break
      default:
        break
    }
  }

  const text = textParts.join('\n')
  flushTextPart()
  const messageContent = hasImageContent ? multimodalParts : text
  if (message.role === 'assistant' && toolCalls.length > 0) {
    return [
      {
        role: 'assistant',
        content: hasImageContent ? messageContent : text || null,
        tool_calls: toolCalls,
      },
    ]
  }

  if (toolResults.length > 0) {
    const result: any[] = []
    if (hasImageContent) {
      result.push({ role: message.role, content: messageContent })
    } else if (text) {
      result.push({ role: message.role, content: text })
    }
    result.push(...toolResults)
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
