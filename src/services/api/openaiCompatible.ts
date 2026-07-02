/**
 * OpenAI-compatible client for local/server providers.
 * Supports LM Studio, llama.cpp, vLLM, and other compatible endpoints.
 */

import { randomUUID } from 'crypto'
import { ProviderResponseParseError } from './providerClient.js'
import {
  createOpenAISSEMessageStream,
  mergeAbortSignals,
} from './streamingAdapters.js'

type URHQClient = {
  beta: { messages: any }
}

export async function createOpenAICompatibleClient(
  options: {
    baseUrl: string
    apiKey?: string
    maxRetries?: number
  },
): Promise<URHQClient> {
  const endpoint = `${options.baseUrl.replace(/\/$/, '')}/chat/completions`

  async function doRequest(params: any, requestOptions?: any) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.apiKey
          ? { Authorization: `Bearer ${options.apiKey}` }
          : {}),
        ...(requestOptions?.headers ?? {}),
      },
      body: JSON.stringify(toOpenAICompatibleRequest(params)),
      signal: requestOptions?.signal,
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(
        `OpenAI-compatible request failed for ${endpoint} (${response.status}): ${body || response.statusText}`,
      )
    }

    const data = await response.json()
    return {
      response,
      data: parseOpenAICompatibleResponse(data, params.model),
    }
  }

  async function doStream(params: any, requestOptions?: any, controller?: AbortController) {
    const streamController = controller ?? new AbortController()
    const signal = mergeAbortSignals([requestOptions?.signal, streamController.signal])
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.apiKey
          ? { Authorization: `Bearer ${options.apiKey}` }
          : {}),
        ...(requestOptions?.headers ?? {}),
      },
      body: JSON.stringify(toOpenAICompatibleRequest({ ...params, stream: true })),
      signal,
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(
        `OpenAI-compatible streaming request failed for ${endpoint} (${response.status}): ${body || response.statusText}`,
      )
    }

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
            input_tokens: Math.ceil(JSON.stringify(params.messages ?? []).length / 4),
          }
        },
      },
    },
  } as URHQClient
}

export function toOpenAICompatibleRequest(params: any): any {
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

export function toOpenAIMessages(params: any): any[] {
  const messages: any[] = []
  const system = systemToText(params.system)
  if (system) {
    messages.push({ role: 'system', content: system })
  }
  const toolNamesById = collectToolNamesById(params.messages)
  for (const message of params.messages ?? []) {
    messages.push(...messageToOpenAIMessages(message, toolNamesById))
  }
  return messages
}

export function systemToText(system: any): string {
  if (!system) return ''
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

export function toOpenAITools(tools: any): any[] {
  if (!Array.isArray(tools)) return []
  const result: any[] = []
  for (const tool of tools) {
    const mapped = toOpenAITool(tool)
    if (mapped) result.push(mapped)
  }
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
  const choice = data.choices?.[0]
  const content = parseOpenAIMessageContent(
    choice?.message,
    choice?.text,
    providerName,
  )
  const includesToolUse = hasToolUse(content)
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
    usage: {
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
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

function toOpenAITool(tool: any): any | null {
  if (
    tool?.type === 'function' &&
    typeof tool.function?.name === 'string' &&
    tool.function.name.length > 0
  ) {
    return {
      type: 'function',
      function: {
        name: tool.function.name,
        ...(tool.function.description !== undefined && {
          description: tool.function.description,
        }),
        parameters: sanitizeJsonSchema(tool.function.parameters),
      },
    }
  }
  if (typeof tool?.name !== 'string' || !('input_schema' in tool)) {
    return null
  }
  return {
    type: 'function',
    function: {
      name: tool.name,
      ...(tool.description !== undefined && { description: tool.description }),
      parameters: sanitizeJsonSchema(tool.input_schema),
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
): any[] {
  const content = message?.content
  if (typeof content === 'string') {
    return [{ role: message.role, content }]
  }
  if (!Array.isArray(content)) {
    return [{ role: message.role, content: '' }]
  }

  const textParts: string[] = []
  const toolCalls: any[] = []
  const toolResults: any[] = []

  for (const block of content) {
    if (typeof block === 'string') {
      textParts.push(block)
      continue
    }
    switch (block?.type) {
      case 'text':
        textParts.push(block.text ?? '')
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
  if (message.role === 'assistant' && toolCalls.length > 0) {
    return [
      {
        role: 'assistant',
        content: text || null,
        tool_calls: toolCalls,
      },
    ]
  }

  if (toolResults.length > 0) {
    const result: any[] = []
    if (text) {
      result.push({ role: message.role, content: text })
    }
    result.push(...toolResults)
    return result
  }

  return [{ role: message.role, content: text }]
}

function parseOpenAIMessageContent(
  message: any,
  legacyText: unknown,
  providerName: string,
): any[] {
  const content: any[] = []
  const text = openAIMessageText(message?.content, legacyText)
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

function hasToolUse(content: any[]): boolean {
  return content.some(block => block?.type === 'tool_use')
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
