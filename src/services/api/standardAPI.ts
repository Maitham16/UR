/**
 * Standard API provider client.
 * Direct HTTP for OpenAI, Anthropic and Gemini, shaped per provider family so
 * each request/response matches the target wire format.
 */

import { randomUUID } from 'crypto'
import {
  getProviderFamily,
  resolveProviderId,
} from '../providers/providerRegistry.js'
import {
  assertNoImageBlocks,
  contentToText,
  normalizeImageBlockSource,
  parseOpenAICompatibleResponse,
  estimateProviderInputTokens,
  systemToText,
  toOpenAICompatibleRequest,
} from './openaiCompatible.js'
import {
  assertValidProviderToolUses,
  isProviderToolInput,
  ProviderCapabilityError,
  ProviderResponseParseError,
} from './providerClient.js'
import {
  axiosPostWithProviderReliability,
  normalizeGeminiBaseUrl,
  normalizeProviderEndpoint,
} from './providerHttp.js'
import {
  createAnthropicSSEMessageStream,
  createGeminiSSEMessageStream,
  createOpenAISSEMessageStream,
  mergeAbortSignals,
} from './streamingAdapters.js'
import {
  GEMINI_THOUGHT_SIGNATURE,
  getGeminiThoughtSignature,
  getStoredGeminiThoughtSignature,
} from './geminiWire.js'
import {
  assertUniqueToolNames,
  assertValidToolName,
  prepareAndValidateToolSchema,
  ToolSchemaValidationError,
} from './toolSchema.js'
import { normalizeGeminiUsage } from './usageNormalization.js'
import {
  getProviderEffortWireValue,
  isEffortLevel,
} from '../../utils/effort.js'

const ANTHROPIC_VERSION = '2023-06-01'

type URHQClient = {
  beta: { messages: any }
}

export async function createStandardAPIClient(options: {
  providerId: string
  apiKey?: string
  maxRetries: number
  model?: string
  baseUrl?: string
}): Promise<URHQClient> {
  const { providerId, apiKey, baseUrl, maxRetries } = options
  const family = getProviderFamily(providerId)

  async function doRequest(params: any, requestOptions?: any) {
    const endpoint = getAPIEndpoint(family, baseUrl, params.model, false)
    const clientRequestId = params?.headers?.['x-client-request-id']
    const response = await axiosPostWithProviderReliability(
      endpoint,
      buildAPIRequest(family, params, providerId),
      {
        headers: {
          'Content-Type': 'application/json',
          ...buildAuthHeaders(family, apiKey, params),
          ...(clientRequestId && { 'x-client-request-id': clientRequestId }),
          ...(requestOptions?.headers ?? {}),
        },
      },
      {
        maxRetries,
        timeoutMs: requestOptions?.timeoutMs,
        signal: requestOptions?.signal,
      },
    )
    return { response, data: parseAPIResponse(family, response.data, params.model) }
  }

  async function doStream(params: any, requestOptions?: any, controller?: AbortController) {
    const endpoint = getAPIEndpoint(family, baseUrl, params.model, true)
    const streamController = controller ?? new AbortController()
    const signal = mergeAbortSignals([requestOptions?.signal, streamController.signal])
    const clientRequestId = params?.headers?.['x-client-request-id']
    const response = await axiosPostWithProviderReliability(
      endpoint,
      buildAPIRequest(family, { ...params, stream: true }, providerId),
      {
        headers: {
          'Content-Type': 'application/json',
          ...buildAuthHeaders(family, apiKey, params),
          ...(clientRequestId && { 'x-client-request-id': clientRequestId }),
          ...(requestOptions?.headers ?? {}),
        },
        responseType: 'stream',
      },
      {
        maxRetries,
        timeoutMs: requestOptions?.timeoutMs,
        signal,
        streaming: true,
      },
    )
    const requestId = providerRequestId(family, response.headers) ?? `${family}-${randomUUID()}`
    const streamOptions = {
      controller: streamController,
      signal,
      model: params.model,
      requestId,
      providerName: family,
    }
    const data =
      family === 'anthropic'
        ? createAnthropicSSEMessageStream(response.data, streamOptions)
        : family === 'google'
          ? createGeminiSSEMessageStream(response.data, streamOptions)
          : createOpenAISSEMessageStream(response.data, streamOptions)
    return { response, data, requestId }
  }

  const messagesAPI = {
    create(params: any, requestOptions?: any) {
      if (params.stream) {
        const controller = new AbortController()
        const pending = doStream(params, requestOptions, controller)
        return {
          async withResponse() {
            const { response, data, requestId } = await pending
            return {
              data,
              response,
              request_id: requestId,
            }
          },
          controller,
        }
      }
      return doRequest(params, requestOptions).then(({ response, data }) => ({
        ...data,
        withResponse: () => ({
          data,
          response,
          request_id: providerRequestId(family, response.headers) ?? data.id ?? randomUUID(),
        }),
      }))
    },
    async countTokens(params: any) {
      return { input_tokens: estimateTokenCount(params) }
    },
  }

  return { beta: { messages: messagesAPI } } as URHQClient
}

function getAPIEndpoint(
  family: string,
  baseUrl: string | undefined,
  model: string,
  stream: boolean,
): string {
  switch (family) {
    case 'openai':
      return normalizeProviderEndpoint(
        baseUrl,
        'https://api.openai.com/v1',
        '/chat/completions',
      )
    case 'anthropic':
      return normalizeProviderEndpoint(
        baseUrl,
        'https://api.anthropic.com/v1',
        '/messages',
      )
    case 'google': {
      const root = normalizeGeminiBaseUrl(baseUrl)
      const method = stream ? 'streamGenerateContent?alt=sse' : 'generateContent'
      return `${root}/models/${model}:${method}`
    }
    default:
      return baseUrl ?? ''
  }
}

function buildAuthHeaders(
  family: string,
  apiKey: string | undefined,
  params: any,
): Record<string, string> {
  switch (family) {
    case 'anthropic': {
      const headers: Record<string, string> = {
        'x-api-key': apiKey ?? '',
        'anthropic-version': ANTHROPIC_VERSION,
      }
      if (Array.isArray(params.betas) && params.betas.length > 0) {
        headers['anthropic-beta'] = params.betas.join(',')
      }
      return headers
    }
    case 'google':
      return { 'x-goog-api-key': apiKey ?? '' }
    default:
      return { Authorization: `Bearer ${apiKey ?? ''}` }
  }
}

function providerOutputConfig(
  params: any,
  providerId: string,
): Record<string, unknown> | undefined {
  const configured = params.output_config
  if (!configured || typeof configured !== 'object' || Array.isArray(configured)) {
    return undefined
  }
  const requested = configured.effort
  if (typeof requested !== 'string' || !isEffortLevel(requested)) {
    return configured
  }
  const provider = resolveProviderId(providerId)
  const wire = provider
    ? getProviderEffortWireValue(String(params.model ?? ''), requested, provider)
    : undefined
  const { effort: _ignored, ...rest } = configured
  if (wire) return { ...rest, effort: wire }
  return requested === 'ultra' ? rest : configured
}

function buildAPIRequest(family: string, params: any, providerId: string): any {
  switch (family) {
    case 'openai': {
      return toOpenAICompatibleRequest(params, 'openai')
    }
    case 'anthropic': {
      const tools = toAnthropicTools(params.tools)
      return {
        model: params.model,
        ...(params.system && { system: toAnthropicSystem(params.system) }),
        messages: toAnthropicMessages(params.messages),
        max_tokens: params.max_tokens ?? 4096,
        ...(params.temperature !== undefined && { temperature: params.temperature }),
        ...(params.top_p !== undefined && { top_p: params.top_p }),
        ...(params.stop_sequences?.length > 0 && { stop_sequences: params.stop_sequences }),
        ...(params.thinking !== undefined && { thinking: params.thinking }),
        ...(params.metadata !== undefined && { metadata: params.metadata }),
        ...(params.output_config !== undefined && {
          output_config: providerOutputConfig(params, providerId),
        }),
        stream: Boolean(params.stream),
        ...(tools.length > 0 ? { tools } : {}),
        ...(params.tool_choice !== undefined ? { tool_choice: params.tool_choice } : {}),
      }
    }
    case 'google': {
      const tools = toGeminiTools(params.tools)
      const thinkingConfig = toGeminiThinkingConfig(params, providerId)
      return {
        contents: toGeminiContents(params),
        ...(geminiSystemInstruction(params) && {
          systemInstruction: geminiSystemInstruction(params),
        }),
        ...(tools.length > 0 ? { tools } : {}),
        ...(params.tool_choice !== undefined
          ? { toolConfig: toGeminiToolConfig(params.tool_choice) }
          : {}),
        generationConfig: {
          ...(params.max_tokens && { maxOutputTokens: params.max_tokens }),
          ...(params.temperature !== undefined && { temperature: params.temperature }),
          ...(params.top_p !== undefined && { topP: params.top_p }),
          ...(params.stop_sequences?.length > 0 && { stopSequences: params.stop_sequences }),
          ...(params.output_config?.format?.type === 'json_schema' && {
            responseMimeType: 'application/json',
            responseSchema: params.output_config.format.schema,
          }),
          ...(thinkingConfig ? { thinkingConfig } : {}),
        },
      }
    }
    default:
      return params
  }
}

function toGeminiThinkingConfig(
  params: any,
  providerId = 'gemini-api',
): Record<string, unknown> | undefined {
  const requested = params.output_config?.effort
  const provider = resolveProviderId(providerId)
  const wireEffort =
    provider && typeof requested === 'string' && isEffortLevel(requested)
      ? getProviderEffortWireValue(String(params.model ?? ''), requested, provider)
      : undefined
  const effort = wireEffort ?? (requested === 'ultra' ? undefined : requested)
  if (wireEffort) {
    return { thinkingLevel: wireEffort }
  }
  if (
    effort === 'minimal' ||
    effort === 'low' ||
    effort === 'medium' ||
    effort === 'high'
  ) {
    return { thinkingLevel: effort }
  }
  // Provider-aware effort resolution normally clamps these before this
  // adapter. Keep direct client calls safe as well.
  if (effort === 'xhigh' || effort === 'max') {
    return { thinkingLevel: 'high' }
  }
  if (params.thinking?.type === 'enabled') {
    return { thinkingBudget: params.thinking.budget_tokens }
  }
  if (params.thinking?.type !== undefined) {
    return { includeThoughts: params.thinking.type !== 'disabled' }
  }
  return undefined
}

function providerRequestId(family: string, headers: any): string | undefined {
  const preferred = family === 'anthropic' ? 'request-id' : 'x-request-id'
  const fallback = preferred === 'request-id' ? 'x-request-id' : 'request-id'
  const value = headers?.get?.(preferred) ?? headers?.[preferred]
  const fallbackValue = headers?.get?.(fallback) ?? headers?.[fallback]
  return typeof value === 'string' && value.length > 0
    ? value
    : typeof fallbackValue === 'string' && fallbackValue.length > 0
      ? fallbackValue
      : undefined
}

function parseAPIResponse(family: string, data: any, fallbackModel: string): any {
  if (data?.error) {
    throw new ProviderResponseParseError(
      `${family} returned an error payload: ${typeof data.error?.message === 'string' ? data.error.message : JSON.stringify(data.error)}`,
      { data },
    )
  }
  switch (family) {
    case 'openai':
      return parseOpenAICompatibleResponse(data, fallbackModel, 'openai')
    case 'anthropic': {
      if (!Array.isArray(data.content)) {
        throw new ProviderResponseParseError('anthropic response did not include content', { data })
      }
      const anthropicContent = parseAnthropicContent(data.content)
      assertValidProviderToolUses(anthropicContent, 'anthropic response')
      if (data.stop_reason === 'tool_use' && !hasToolUse(anthropicContent)) {
        throw new ProviderResponseParseError(
          'anthropic response stopped for tool_use but did not include a tool_use block',
          { data },
        )
      }
      return {
        id: data.id ?? `anthropic-${randomUUID()}`,
        type: 'message',
        role: 'assistant',
        model: data.model ?? fallbackModel,
        content: anthropicContent,
        stop_reason: mapStopReason(data.stop_reason),
        stop_sequence: data.stop_sequence ?? null,
        usage: {
          input_tokens: data.usage?.input_tokens ?? 0,
          output_tokens: data.usage?.output_tokens ?? 0,
          cache_creation_input_tokens: data.usage?.cache_creation_input_tokens ?? 0,
          cache_read_input_tokens: data.usage?.cache_read_input_tokens ?? 0,
        },
      }
    }
    case 'google': {
      if (!data.candidates?.[0]) {
        throw new ProviderResponseParseError('gemini response did not include a candidate', { data })
      }
      const parts = data.candidates?.[0]?.content?.parts ?? []
      const content = parseGeminiParts(parts)
      assertValidProviderToolUses(content, 'gemini response')
      if (
        data.candidates?.[0]?.finishReason === 'FUNCTION_CALL' &&
        !hasToolUse(content)
      ) {
        throw new ProviderResponseParseError(
          'gemini response finished with FUNCTION_CALL but did not include a functionCall part',
          { data },
        )
      }
      return {
        id: `gemini-${randomUUID()}`,
        type: 'message',
        role: 'assistant',
        model: fallbackModel,
        content,
        stop_reason: mapStopReason(
          data.candidates?.[0]?.finishReason,
          hasToolUse(content),
        ),
        stop_sequence: null,
        usage: normalizeGeminiUsage(data.usageMetadata),
      }
    }
    default:
      return data
  }
}

function hasToolUse(content: any[]): boolean {
  return content.some(block => block?.type === 'tool_use')
}

function mapStopReason(reason: string | undefined, includesToolUse = false): string {
  if (
    includesToolUse ||
    reason === 'tool_calls' ||
    reason === 'function_call' ||
    reason === 'tool_use' ||
    reason === 'FUNCTION_CALL'
  ) {
    return 'tool_use'
  }
  switch (reason) {
    case 'length':
    case 'MAX_TOKENS':
      return 'max_tokens'
    case 'stop':
    case 'STOP':
    case 'end':
    case 'end_turn':
    case undefined:
      return 'end_turn'
    default:
      return 'end_turn'
  }
}

function toGeminiContents(params: any): Array<{ role: string; parts: any[] }> {
  const toolNamesById = collectToolNamesById(params.messages)
  return (params.messages ?? []).map((message: any) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: contentToGeminiParts(message.content, toolNamesById),
  }))
}

function geminiSystemInstruction(params: any): { parts: Array<{ text: string }> } | undefined {
  const system = systemToText(params.system, 'gemini')
  return system ? { parts: [{ text: system }] } : undefined
}

function toAnthropicSystem(system: any): any {
  assertNoImageBlocks(system, 'anthropic', 'system content')
  return system
}

function toAnthropicMessages(messages: any): any[] {
  if (!Array.isArray(messages)) return []
  return messages.map((message, messageIndex) => ({
    ...message,
    content: toAnthropicContent(
      message?.content,
      `messages[${messageIndex}].content`,
    ),
  }))
}

function toAnthropicContent(content: any, context: string): any {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((block, index) =>
    toAnthropicContentBlock(block, `${context}[${index}]`),
  )
}

function toAnthropicContentBlock(block: any, context: string): any {
  if (typeof block === 'string') return { type: 'text', text: block }
  if (block?.type === 'text') {
    return { type: 'text', text: block.text ?? '' }
  }
  if (block?.type === 'image') {
    const source = normalizeImageBlockSource(block, 'anthropic', context)
    if (source.type === 'base64') {
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: source.mediaType,
          data: source.data,
        },
      }
    }
    return {
      type: 'image',
      source: {
        type: 'url',
        url: source.url,
      },
    }
  }
  if (block?.type === 'tool_result') {
    return {
      ...block,
      content: toAnthropicToolResultContent(
        block.content,
        `${context}.content`,
      ),
    }
  }
  return block
}

function toAnthropicToolResultContent(content: any, context: string): any {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return content
  return content.map((block, index) =>
    toAnthropicToolResultBlock(block, `${context}[${index}]`),
  )
}

function toAnthropicToolResultBlock(block: any, context: string): any {
  if (typeof block === 'string') return { type: 'text', text: block }
  if (block?.type === 'text') {
    return { type: 'text', text: block.text ?? '' }
  }
  if (block?.type === 'image') {
    return toAnthropicContentBlock(block, context)
  }
  return block
}

function toAnthropicTools(tools: any): any[] {
  if (tools === undefined || tools === null) return []
  if (!Array.isArray(tools)) {
    throw new ToolSchemaValidationError('Anthropic tools must be an array.')
  }
  const mapped = tools.map(tool => {
    if (!tool || typeof tool !== 'object' || !('input_schema' in tool)) {
      throw new ToolSchemaValidationError(
        'Anthropic tool entry is missing required name/input_schema fields.',
      )
    }
    assertValidToolName(tool.name, 'Anthropic')
    return {
      name: tool.name,
      ...(tool.description !== undefined && { description: tool.description }),
      input_schema: prepareAndValidateToolSchema(tool.input_schema, tool.name),
      ...(tool.strict === true && { strict: true }),
    }
  })
  assertUniqueToolNames(mapped.map(tool => tool.name), 'Anthropic')
  return mapped
}

function toGeminiTools(tools: any): any[] {
  if (tools === undefined || tools === null) return []
  if (!Array.isArray(tools)) {
    throw new ToolSchemaValidationError('Gemini tools must be an array.')
  }
  const declarations = tools.map(tool => {
    if (!tool || typeof tool !== 'object' || !('input_schema' in tool)) {
      throw new ToolSchemaValidationError(
        'Gemini tool entry is missing required name/input_schema fields.',
      )
    }
    assertValidToolName(tool.name, 'Gemini')
    return {
      name: tool.name,
      ...(tool.description !== undefined && { description: tool.description }),
      parametersJsonSchema: prepareAndValidateToolSchema(
        tool.input_schema,
        tool.name,
        'gemini',
      ),
    }
  })
  assertUniqueToolNames(declarations.map(tool => tool.name), 'Gemini')
  return declarations.length > 0 ? [{ functionDeclarations: declarations }] : []
}

function toGeminiToolConfig(toolChoice: any): any {
  if (typeof toolChoice === 'string') {
    switch (toolChoice) {
      case 'none':
        return { functionCallingConfig: { mode: 'NONE' } }
      case 'any':
      case 'required':
        return { functionCallingConfig: { mode: 'ANY' } }
      default:
        return { functionCallingConfig: { mode: 'AUTO' } }
    }
  }
  switch (toolChoice?.type) {
    case 'none':
      return { functionCallingConfig: { mode: 'NONE' } }
    case 'any':
      return { functionCallingConfig: { mode: 'ANY' } }
    case 'tool':
      if (typeof toolChoice.name !== 'string' || toolChoice.name.length === 0) {
        throw new Error('Invalid tool_choice: Gemini tool choice requires a tool name')
      }
      return {
        functionCallingConfig: {
          mode: 'ANY',
          allowedFunctionNames: [toolChoice.name],
        },
      }
    case 'auto':
    default:
      return { functionCallingConfig: { mode: 'AUTO' } }
  }
}

function parseAnthropicContent(content: any): any[] {
  if (!Array.isArray(content)) return [{ type: 'text', text: '' }]
  const result = content.map((block, index) => {
    if (block?.type === 'text') {
      return { type: 'text', text: block.text ?? '' }
    }
    if (block?.type === 'tool_use') {
      if (
        typeof block.id !== 'string' ||
        block.id.length === 0 ||
        typeof block.name !== 'string' ||
        block.name.length === 0
      ) {
        throw new ProviderResponseParseError(
          `anthropic content[${index}] is an invalid tool_use block`,
          { block },
        )
      }
      if (!isProviderToolInput(block.input ?? {})) {
        throw new ProviderResponseParseError(
          `anthropic content[${index}].input must be a JSON object`,
          { block },
        )
      }
      return {
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: block.input ?? {},
      }
    }
    return block
  })
  return result.length > 0 ? result : [{ type: 'text', text: '' }]
}

function parseGeminiParts(parts: any): any[] {
  if (!Array.isArray(parts)) return [{ type: 'text', text: '' }]
  const content: any[] = []
  for (const [index, part] of parts.entries()) {
    const thoughtSignature = getGeminiThoughtSignature(part)
    if (part?.functionCall !== undefined) {
      const call = part.functionCall
      if (typeof call?.name !== 'string' || call.name.length === 0) {
        throw new ProviderResponseParseError(
          `gemini candidates[0].content.parts[${index}].functionCall.name is required`,
          { functionCall: call },
        )
      }
      content.push({
        type: 'tool_use',
        id: typeof call.id === 'string' && call.id.length > 0
          ? call.id
          : `gemini_tool_${randomUUID()}`,
        name: call.name,
        input: parseGeminiFunctionArgs(
          call.args,
          `gemini candidates[0].content.parts[${index}].functionCall.args`,
        ),
        ...(thoughtSignature && {
          [GEMINI_THOUGHT_SIGNATURE]: thoughtSignature,
        }),
      })
      continue
    }

    if (typeof part?.text !== 'string') continue
    const block = part.thought === true
      ? { type: 'thinking', thinking: part.text }
      : { type: 'text', text: part.text }
    if (part.text.length > 0 || thoughtSignature) {
      content.push({
        ...block,
        ...(thoughtSignature && {
          [GEMINI_THOUGHT_SIGNATURE]: thoughtSignature,
        }),
      })
    }
  }
  return content.length > 0 ? content : [{ type: 'text', text: '' }]
}

function parseGeminiFunctionArgs(args: unknown, path: string): unknown {
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

function contentToGeminiParts(content: any, toolNamesById: Map<string, string>): any[] {
  if (typeof content === 'string') return [{ text: content }]
  if (!Array.isArray(content)) return [{ text: '' }]

  const parts: any[] = []
  let pendingTextParts: string[] = []
  const flushTextPart = () => {
    if (pendingTextParts.length === 0) return
    const text = pendingTextParts.join('\n')
    if (text.length > 0) {
      parts.push({ text })
    }
    pendingTextParts = []
  }

  for (const [index, block] of content.entries()) {
    if (typeof block === 'string') {
      pendingTextParts.push(block)
      continue
    }
    switch (block?.type) {
      case 'text':
        if (getStoredGeminiThoughtSignature(block)) {
          flushTextPart()
          parts.push({
            text: block.text ?? '',
            thoughtSignature: getStoredGeminiThoughtSignature(block),
          })
        } else {
          pendingTextParts.push(block.text ?? '')
        }
        break
      case 'thinking':
        flushTextPart()
        parts.push({
          text: block.thinking ?? '',
          thought: true,
          ...(getStoredGeminiThoughtSignature(block) && {
            thoughtSignature: getStoredGeminiThoughtSignature(block),
          }),
        })
        break
      case 'image':
        flushTextPart()
        parts.push(imageBlockToGeminiPart(block, `content[${index}]`))
        break
      case 'tool_use':
        flushTextPart()
        parts.push({
          functionCall: {
            name: block.name,
            args: block.input ?? {},
            ...(typeof block.id === 'string' && block.id.length > 0 && {
              id: block.id,
            }),
          },
          ...(getStoredGeminiThoughtSignature(block) && {
            thoughtSignature: getStoredGeminiThoughtSignature(block),
          }),
        })
        break
      case 'tool_result':
        flushTextPart()
        assertNoImageBlocks(
          block.content,
          'gemini',
          `tool_result ${block.tool_use_id ?? index} content`,
        )
        parts.push({
          functionResponse: {
            name: toolNamesById.get(block.tool_use_id) ?? block.tool_use_id,
            response: { result: contentToText(block.content) },
            ...(typeof block.tool_use_id === 'string' &&
              block.tool_use_id.length > 0 && { id: block.tool_use_id }),
          },
        })
        break
      default:
        break
    }
  }
  flushTextPart()
  return parts.length > 0 ? parts : [{ text: '' }]
}

function imageBlockToGeminiPart(block: any, context: string): any {
  const source = normalizeImageBlockSource(block, 'gemini', context)
  if (source.type === 'base64') {
    return {
      inlineData: {
        mimeType: source.mediaType,
        data: source.data,
      },
    }
  }
  if (!source.mediaType) {
    throw new ProviderCapabilityError(
      'gemini image URL content requires media_type for fileData mapping',
      { providerName: 'gemini', capability: 'multimodal_input', context },
    )
  }
  return {
    fileData: {
      mimeType: source.mediaType,
      fileUri: source.url,
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

// Delegates to the shared preparation pass: strips meta and vendor keys at
// every depth (not just the root) and inlines local $ref targets that most
// providers cannot resolve. See services/api/toolSchema.ts.
function estimateTokenCount(params: any): number {
  return estimateProviderInputTokens(params)
}
