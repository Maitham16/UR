/**
 * Standard API provider client.
 * Direct HTTP for OpenAI, Anthropic and Gemini, shaped per provider family so
 * each request/response matches the target wire format.
 */

import axios from 'axios'
import { randomUUID } from 'crypto'
import { getProviderFamily } from '../providers/providerRegistry.js'
import {
  contentToText,
  mapOpenAIToolChoice,
  parseOpenAICompatibleResponse,
  systemToText,
  toOpenAIMessages,
  toOpenAITools,
} from './openaiCompatible.js'
import { ProviderResponseParseError } from './providerClient.js'
import {
  createAnthropicSSEMessageStream,
  createGeminiSSEMessageStream,
  createOpenAISSEMessageStream,
  getProviderRequestTimeoutMs,
  mergeAbortSignals,
} from './streamingAdapters.js'

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
  const { providerId, apiKey, baseUrl } = options
  const family = getProviderFamily(providerId)

  async function doRequest(params: any, requestOptions?: any) {
    const endpoint = getAPIEndpoint(family, baseUrl, params.model, false)
    const clientRequestId = params?.headers?.['x-client-request-id']
    const response = await axios.post(endpoint, buildAPIRequest(family, params), {
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(family, apiKey, params),
        ...(clientRequestId && { 'x-client-request-id': clientRequestId }),
        ...(requestOptions?.headers ?? {}),
      },
      timeout: getProviderRequestTimeoutMs(),
      signal: requestOptions?.signal,
    })
    return { response, data: parseAPIResponse(family, response.data, params.model) }
  }

  async function doStream(params: any, requestOptions?: any, controller?: AbortController) {
    const endpoint = getAPIEndpoint(family, baseUrl, params.model, true)
    const streamController = controller ?? new AbortController()
    const signal = mergeAbortSignals([requestOptions?.signal, streamController.signal])
    const clientRequestId = params?.headers?.['x-client-request-id']
    const response = await axios.post(
      endpoint,
      buildAPIRequest(family, { ...params, stream: true }),
      {
        headers: {
          'Content-Type': 'application/json',
          ...buildAuthHeaders(family, apiKey, params),
          ...(clientRequestId && { 'x-client-request-id': clientRequestId }),
          ...(requestOptions?.headers ?? {}),
        },
        timeout: getProviderRequestTimeoutMs(),
        responseType: 'stream',
        signal,
      },
    )
    const requestId = response.headers?.['x-request-id'] ?? `${family}-${randomUUID()}`
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
          request_id: data.id ?? response.headers?.['x-request-id'] ?? randomUUID(),
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
      return baseUrl ?? 'https://api.openai.com/v1/chat/completions'
    case 'anthropic':
      return baseUrl ?? 'https://api.anthropic.com/v1/messages'
    case 'google': {
      const root = baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta'
      const method = stream ? 'streamGenerateContent?alt=sse' : 'generateContent'
      return `${root.replace(/\/$/, '')}/models/${model}:${method}`
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

function buildAPIRequest(family: string, params: any): any {
  switch (family) {
    case 'openai': {
      const tools = toOpenAITools(params.tools)
      return {
        model: params.model,
        messages: toOpenAIMessages(params),
        max_tokens: params.max_tokens,
        ...(params.temperature !== undefined && { temperature: params.temperature }),
        stream: Boolean(params.stream),
        ...(tools.length > 0 ? { tools } : {}),
        ...(params.tool_choice !== undefined
          ? { tool_choice: mapOpenAIToolChoice(params.tool_choice) }
          : {}),
      }
    }
    case 'anthropic': {
      const tools = toAnthropicTools(params.tools)
      return {
        model: params.model,
        ...(params.system && { system: params.system }),
        messages: params.messages,
        max_tokens: params.max_tokens ?? 4096,
        ...(params.temperature !== undefined && { temperature: params.temperature }),
        stream: Boolean(params.stream),
        ...(tools.length > 0 ? { tools } : {}),
        ...(params.tool_choice !== undefined ? { tool_choice: params.tool_choice } : {}),
      }
    }
    case 'google': {
      const tools = toGeminiTools(params.tools)
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
        },
      }
    }
    default:
      return params
  }
}

function parseAPIResponse(family: string, data: any, fallbackModel: string): any {
  switch (family) {
    case 'openai':
      return parseOpenAICompatibleResponse(data, fallbackModel, 'openai')
    case 'anthropic': {
      const anthropicContent = parseAnthropicContent(data.content)
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
      const parts = data.candidates?.[0]?.content?.parts ?? []
      const content = parseGeminiParts(parts)
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
        usage: {
          input_tokens: data.usageMetadata?.promptTokenCount ?? 0,
          output_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
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
  const system = systemToText(params.system)
  return system ? { parts: [{ text: system }] } : undefined
}

function toAnthropicTools(tools: any): any[] {
  if (!Array.isArray(tools)) return []
  return tools
    .filter(tool => typeof tool?.name === 'string' && 'input_schema' in tool)
    .map(tool => ({
      name: tool.name,
      ...(tool.description !== undefined && { description: tool.description }),
      input_schema: sanitizeJsonSchema(tool.input_schema),
    }))
}

function toGeminiTools(tools: any): any[] {
  const declarations = toAnthropicTools(tools).map(tool => ({
    name: tool.name,
    ...(tool.description !== undefined && { description: tool.description }),
    parameters: tool.input_schema,
  }))
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
  const text = parts.map((part: any) => part?.text ?? '').join('')
  if (text.length > 0) {
    content.push({ type: 'text', text })
  }
  for (const [index, part] of parts.entries()) {
    if (part?.functionCall === undefined) continue
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
    })
  }
  return content.length > 0 ? content : [{ type: 'text', text: '' }]
}

function parseGeminiFunctionArgs(args: unknown, path: string): unknown {
  if (args === undefined || args === null || args === '') return {}
  if (typeof args !== 'string') return args
  try {
    return JSON.parse(args)
  } catch (error) {
    throw new ProviderResponseParseError(`${path} is not valid JSON`, {
      args,
      cause: error,
    })
  }
}

function contentToGeminiParts(content: any, toolNamesById: Map<string, string>): any[] {
  if (typeof content === 'string') return [{ text: content }]
  if (!Array.isArray(content)) return [{ text: '' }]

  const parts: any[] = []
  const text = contentToText(content)
  if (text) {
    parts.push({ text })
  }
  for (const block of content) {
    if (block?.type === 'tool_use') {
      parts.push({
        functionCall: {
          name: block.name,
          args: block.input ?? {},
        },
      })
    } else if (block?.type === 'tool_result') {
      parts.push({
        functionResponse: {
          name: toolNamesById.get(block.tool_use_id) ?? block.tool_use_id,
          response: { result: contentToText(block.content) },
        },
      })
    }
  }
  return parts.length > 0 ? parts : [{ text: '' }]
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

function sanitizeJsonSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { type: 'object', properties: {} }
  }
  const clone = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>
  delete clone.cache_control
  delete clone.strict
  delete clone.defer_loading
  delete clone.eager_input_streaming
  return clone
}

function estimateTokenCount(params: any): number {
  return Math.ceil(JSON.stringify(params.messages ?? []).length / 4)
}
