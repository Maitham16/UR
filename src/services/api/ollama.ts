import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
} from '@urhq-ai/sdk'
import type {
  BetaContentBlock,
  BetaMessage,
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent,
  BetaToolUnion,
  BetaUsage,
} from '@urhq-ai/sdk/resources/beta/messages/messages.mjs'
import type { MessageParam } from '@urhq-ai/sdk/resources/index.mjs'
import type { Stream } from '@urhq-ai/sdk/streaming.mjs'
import { randomUUID } from 'crypto'
import {
  cacheOllamaModelMetadata,
  getOllamaContextLengthForModel,
} from '../../utils/model/ollamaModels.js'
import {
  computeOllamaNumCtx,
  getOllamaKeepAlive,
  getOllamaNumCtxOverride,
} from '../../utils/model/ollamaTuning.js'
import {
  looksLikeBareJsonToolCallPrefix,
  parseBareJsonToolCalls,
  parseClarifyingQuestions,
  parseKimiToolCalls,
  parseTextToolCalls,
  reconcileToolName,
  type ParsedToolCall,
} from '../../cli/transports/kimiToolCalls.js'

type OllamaMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  images?: string[]
  tool_calls?: OllamaToolCall[]
  tool_name?: string
}

type OllamaTool = {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

type OllamaToolCall = {
  function?: {
    name?: string
    arguments?: unknown
  }
}

type OllamaChatChunk = {
  model?: string
  message?: {
    role?: string
    content?: string
    thinking?: string
    tool_calls?: OllamaToolCall[]
  }
  done?: boolean
  done_reason?: string
  prompt_eval_count?: number
  eval_count?: number
  error?: string
}

type OllamaModelCapabilities = Set<string>

type OllamaStreamReadResult = Awaited<
  ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>
>

type RequestOptions = {
  signal?: AbortSignal
  timeout?: number
}

type OllamaStopReason = 'end_turn' | 'max_tokens' | 'tool_use'

type OllamaChatRequest = {
  model: string
  messages: OllamaMessage[]
  stream: boolean
  think?: boolean | 'high' | 'medium' | 'low'
  tools?: OllamaTool[]
  keep_alive?: string | number
  options?: {
    temperature?: number
    num_predict?: number
    num_ctx?: number
  }
  format?: unknown
}

const OLLAMA_BASE_URL = 'http://localhost:11434'
const DEFAULT_OLLAMA_REQUEST_TIMEOUT_MS = 300_000
const REMOTE_OLLAMA_REQUEST_TIMEOUT_MS = 120_000
const ollamaModelCapabilitiesCache = new Map<
  string,
  OllamaModelCapabilities | null
>()

export function createOllamaURHQClient(): unknown {
  return {
    beta: {
      messages: {
        create(params: BetaMessageStreamParams, options?: RequestOptions) {
          if (params.stream) {
            return createStreamingRequest(params, options)
          }
          return createNonStreamingRequest(params, options)
        },
        async countTokens(params: {
          messages?: MessageParam[]
          system?: BetaMessageStreamParams['system']
          tools?: BetaMessageStreamParams['tools']
        }) {
          return {
            input_tokens: estimateInputTokens(params),
          }
        },
      },
    },
  }
}

function createStreamingRequest(
  params: BetaMessageStreamParams,
  options?: RequestOptions,
) {
  const controller = createLinkedAbortController(options)
  const responsePromise = fetchOllamaChat(params, true, controller, options)

  return {
    async withResponse() {
      const response = await responsePromise
      const requestId = `ollama-${randomUUID()}`
      return {
        data: createURHQStream(response, params, controller, requestId, options),
        request_id: requestId,
        response,
      }
    },
  }
}

async function createNonStreamingRequest(
  params: BetaMessageStreamParams,
  options?: RequestOptions,
): Promise<BetaMessage> {
  const controller = createLinkedAbortController(options)
  const response = await fetchOllamaChat(params, false, controller, options)
  const json = (await response.json()) as OllamaChatChunk
  if (json.error) {
    throw new Error(json.error)
  }
  return ollamaResponseToURHQMessage(json, params)
}

async function fetchOllamaChat(
  params: BetaMessageStreamParams,
  stream: boolean,
  controller: AbortController,
  options?: RequestOptions,
): Promise<Response> {
  // Match the main API timeout convention. Larger local models can take more
  // than 30s to load before Ollama returns response headers, especially after
  // tool-result turns.
  const timeout = getOllamaRequestTimeoutMs(options)
  const timeoutId =
    timeout > 0
      ? setTimeout(() => controller.abort(), timeout)
      : undefined

  try {
    const capabilities = await getOllamaModelCapabilities(
      params.model,
      controller.signal,
    )
    const response = await fetch(`${getOllamaBaseUrl()}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(toOllamaChatRequest(params, stream, capabilities)),
      signal: controller.signal,
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(
        `Ollama request failed (${response.status}): ${body || response.statusText}`,
      )
    }

    return response
  } catch (error) {
    if (controller.signal.aborted) {
      if (options?.signal?.aborted) {
        throw new APIUserAbortError()
      }
      throw new APIConnectionTimeoutError({ message: 'Ollama request timed out' })
    }
    if (error instanceof Error) {
      throw new APIConnectionError({ message: error.message, cause: error })
    }
    throw error
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

function createLinkedAbortController(options?: RequestOptions): AbortController {
  const controller = new AbortController()
  const signal = options?.signal
  if (!signal) {
    return controller
  }
  if (signal.aborted) {
    controller.abort()
    return controller
  }
  signal.addEventListener('abort', () => controller.abort(), { once: true })
  return controller
}

function getOllamaBaseUrl(): string {
  return OLLAMA_BASE_URL
}

export function getOllamaRequestTimeoutMs(
  options?: RequestOptions,
  env: Record<string, string | undefined> = process.env,
): number {
  if (options?.timeout !== undefined) {
    return options.timeout
  }

  const override = parseInt(env.API_TIMEOUT_MS || '', 10)
  if (override > 0) {
    return override
  }

  return isTruthyEnv(env.UR_CODE_REMOTE)
    ? REMOTE_OLLAMA_REQUEST_TIMEOUT_MS
    : DEFAULT_OLLAMA_REQUEST_TIMEOUT_MS
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false
  }
  return !['0', 'false', 'no', 'off'].includes(value.toLowerCase())
}

function toOllamaChatRequest(
  params: BetaMessageStreamParams,
  stream: boolean,
  capabilities: OllamaModelCapabilities | null,
): OllamaChatRequest {
  const supportsTools = modelCapabilityEnabled(capabilities, 'tools')
  const tools = supportsTools ? toOllamaTools(params.tools) : []
  const systemMessage: OllamaMessage = {
    role: 'system',
    content: systemToText(params.system),
  }
  const think = getOllamaThink(params, capabilities)
  const request: OllamaChatRequest = {
    model: params.model,
    messages: [
      systemMessage,
      ...messagesToOllama(
        params.messages,
        modelCapabilityEnabled(capabilities, 'vision'),
      ),
    ].filter(
      message =>
        message.role === 'tool' ||
        message.content.trim() !== '' ||
        (message.images?.length ?? 0) > 0 ||
        (message.tool_calls?.length ?? 0) > 0,
    ),
    stream,
    ...(tools.length > 0 ? { tools } : {}),
    ...(think !== undefined ? { think } : {}),
  }

  const options: OllamaChatRequest['options'] = {}
  if (typeof params.temperature === 'number') {
    options.temperature = params.temperature
  }
  if (typeof params.max_tokens === 'number') {
    options.num_predict = params.max_tokens
  }
  const numCtx = computeOllamaNumCtx({
    modelContextLength: getOllamaContextLengthForModel(params.model),
    estimatedPromptTokens: estimateInputTokens(params),
    maxTokens:
      typeof params.max_tokens === 'number' ? params.max_tokens : undefined,
    override: getOllamaNumCtxOverride(),
  })
  if (numCtx !== undefined) {
    options.num_ctx = numCtx
  }
  if (Object.keys(options).length > 0) {
    request.options = options
  }

  const keepAlive = getOllamaKeepAlive()
  if (keepAlive !== undefined) {
    request.keep_alive = keepAlive
  }

  const format = getOllamaFormat(params)
  if (format !== undefined) {
    request.format = format
  }

  return request
}

function systemToText(system: BetaMessageStreamParams['system']): string {
  if (!system) {
    return ''
  }
  if (typeof system === 'string') {
    return system
  }
  return system.map(block => block.text).join('\n\n')
}

function messagesToOllama(
  messages: MessageParam[],
  supportsVision: boolean,
): OllamaMessage[] {
  const result: OllamaMessage[] = []
  const toolNamesById = new Map<string, string>()

  for (const message of messages) {
    if (message.role === 'assistant') {
      const textParts: string[] = []
      const toolCalls: OllamaToolCall[] = []
      const content = message.content

      if (typeof content === 'string') {
        textParts.push(content)
      } else {
        for (const block of content) {
          if (block.type === 'text') {
            textParts.push(block.text)
          } else if (block.type === 'tool_use') {
            toolNamesById.set(block.id, block.name)
            toolCalls.push({
              function: {
                name: block.name,
                arguments: block.input,
              },
            })
          }
        }
      }

      result.push({
        role: 'assistant',
        content: textParts.filter(Boolean).join('\n\n'),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      })
      continue
    }

    const content = message.content
    if (typeof content === 'string') {
      result.push({ role: 'user', content })
      continue
    }

    const textParts: string[] = []
    const images: string[] = []
    const toolMessages: OllamaMessage[] = []
    for (const block of content) {
      switch (block.type) {
        case 'text':
          textParts.push(block.text)
          break
        case 'tool_result': {
          const toolName = toolNamesById.get(block.tool_use_id) ?? block.tool_use_id
          toolMessages.push({
            role: 'tool',
            content: contentBlockToText(block.content),
            tool_name: toolName,
          })
          break
        }
        case 'image':
          if (supportsVision && block.source.type === 'base64') {
            images.push(block.source.data)
          } else if (!supportsVision) {
            textParts.push('[Image input omitted: selected Ollama model does not advertise vision support]')
          } else {
            textParts.push('[Image input omitted: unsupported image source]')
          }
          break
        case 'document':
          textParts.push('[Document input omitted: Ollama adapter does not support document blocks]')
          break
      }
    }

    for (const toolMessage of toolMessages) {
      result.push(toolMessage)
    }

    const text = textParts.filter(Boolean).join('\n\n')
    if (text || images.length > 0) {
      result.push({
        role: 'user',
        content: text,
        ...(images.length > 0 ? { images } : {}),
      })
    }
  }

  return result
}

function toOllamaTools(tools: BetaMessageStreamParams['tools']): OllamaTool[] {
  if (!tools) {
    return []
  }
  const result: OllamaTool[] = []
  for (const tool of tools as BetaToolUnion[]) {
    if (!('name' in tool) || !('input_schema' in tool)) {
      continue
    }
    result.push({
      type: 'function',
      function: {
        name: tool.name,
        description: 'description' in tool ? tool.description : undefined,
        parameters: sanitizeJsonSchema(tool.input_schema),
      },
    })
  }
  return result
}

function getAvailableToolNames(
  tools: BetaMessageStreamParams['tools'],
): Set<string> {
  const names = new Set<string>()
  for (const tool of (tools ?? []) as BetaToolUnion[]) {
    if ('name' in tool && typeof tool.name === 'string') {
      names.add(tool.name)
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

function getOllamaFormat(params: BetaMessageStreamParams): unknown {
  const outputConfig = (params as { output_config?: unknown }).output_config as
    | { format?: { type?: string; schema?: unknown } }
    | undefined
  const format = outputConfig?.format
  if (!format) {
    return undefined
  }
  if (format.type === 'json_schema' && format.schema) {
    return format.schema
  }
  if (format.type === 'json_object') {
    return 'json'
  }
  return undefined
}

function getOllamaThink(
  params: BetaMessageStreamParams,
  capabilities: OllamaModelCapabilities | null,
): OllamaChatRequest['think'] {
  const thinking = (params as { thinking?: { type?: string } }).thinking
  const supportsThinking = modelCapabilityEnabled(capabilities, 'thinking')
  if (capabilities && !supportsThinking) {
    return undefined
  }
  if (thinking && thinking.type !== 'disabled') {
    return true
  }
  if (supportsThinking) {
    return false
  }
  return undefined
}

function modelCapabilityEnabled(
  capabilities: OllamaModelCapabilities | null,
  capability: string,
): boolean {
  return capabilities?.has(capability) ?? true
}

async function getOllamaModelCapabilities(
  model: string,
  signal?: AbortSignal,
): Promise<OllamaModelCapabilities | null> {
  const normalizedModel = model.trim()
  if (!normalizedModel) {
    return null
  }
  if (ollamaModelCapabilitiesCache.has(normalizedModel)) {
    return ollamaModelCapabilitiesCache.get(normalizedModel) ?? null
  }

  try {
    const response = await fetch(`${getOllamaBaseUrl()}/api/show`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: normalizedModel }),
      signal,
    })
    if (!response.ok) {
      ollamaModelCapabilitiesCache.set(normalizedModel, null)
      return null
    }
    const body = await response.json()
    cacheOllamaModelMetadata(normalizedModel, body)
    const capabilities = parseOllamaModelCapabilities(body)
    ollamaModelCapabilitiesCache.set(normalizedModel, capabilities)
    return capabilities
  } catch (error) {
    if (signal?.aborted) {
      throw error
    }
    ollamaModelCapabilitiesCache.set(normalizedModel, null)
    return null
  }
}

function parseOllamaModelCapabilities(value: unknown): OllamaModelCapabilities | null {
  if (!value || typeof value !== 'object' || !('capabilities' in value)) {
    return null
  }
  const capabilities = (value as { capabilities?: unknown }).capabilities
  if (!Array.isArray(capabilities)) {
    return null
  }
  return new Set(
    capabilities.flatMap(capability =>
      typeof capability === 'string' && capability.trim()
        ? [capability.trim()]
        : [],
    ),
  )
}

function createURHQStream(
  response: Response,
  params: BetaMessageStreamParams,
  controller: AbortController,
  requestId: string,
  options?: RequestOptions,
): Stream<BetaRawMessageStreamEvent> {
  const stream = {
    controller,
    async *[Symbol.asyncIterator](): AsyncGenerator<BetaRawMessageStreamEvent> {
      yield* streamURHQEvents(response, params, controller, requestId, options)
    },
  }
  return stream as unknown as Stream<BetaRawMessageStreamEvent>
}

async function* streamURHQEvents(
  response: Response,
  params: BetaMessageStreamParams,
  controller: AbortController,
  requestId: string,
  options?: RequestOptions,
): AsyncGenerator<BetaRawMessageStreamEvent> {
  const usage = emptyUsage()
  yield {
    type: 'message_start',
    message: {
      id: requestId,
      type: 'message',
      role: 'assistant',
      model: params.model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage,
    },
  } as BetaRawMessageStreamEvent

  let textStarted = false
  let thinkingStarted = false
  let text = '' // raw accumulated content (used to parse text-form tool calls)
  let thinking = ''
  let emittedLen = 0 // chars of visible prose already streamed
  let inToolSection = false // once Kimi/ChatML tool markup starts, stop streaming text
  let activeBlock: 'text' | 'thinking' | null = null
  let blockIndex = 0
  let finalChunk: OllamaChatChunk | undefined
  const toolCalls: OllamaToolCall[] = []
  const availableToolNames = getAvailableToolNames(params.tools)
  const textToolCalls: ParsedToolCall[] = []
  let pendingVisibleText = ''

  const textEvents = (value: string): BetaRawMessageStreamEvent[] => {
    if (!value) return []
    const events: BetaRawMessageStreamEvent[] = []
    stopActiveBlock(events, 'thinking')
    if (activeBlock !== 'text') {
      textStarted = true
      activeBlock = 'text'
      events.push({
        type: 'content_block_start',
        index: blockIndex,
        content_block: { type: 'text', text: '' },
      } as BetaRawMessageStreamEvent)
    }
    events.push({
      type: 'content_block_delta',
      index: blockIndex,
      delta: { type: 'text_delta', text: value },
    } as BetaRawMessageStreamEvent)
    return events
  }

  const thinkingEvents = (value: string): BetaRawMessageStreamEvent[] => {
    if (!value) return []
    const events: BetaRawMessageStreamEvent[] = []
    stopActiveBlock(events, 'text')
    if (activeBlock !== 'thinking') {
      thinkingStarted = true
      activeBlock = 'thinking'
      events.push({
        type: 'content_block_start',
        index: blockIndex,
        content_block: { type: 'thinking', thinking: '', signature: '' },
      } as BetaRawMessageStreamEvent)
    }
    events.push({
      type: 'content_block_delta',
      index: blockIndex,
      delta: { type: 'thinking_delta', thinking: value },
    } as BetaRawMessageStreamEvent)
    return events
  }

  const stopActiveBlock = (
    events: BetaRawMessageStreamEvent[],
    expected?: 'text' | 'thinking',
  ): void => {
    if (!activeBlock || (expected && activeBlock !== expected)) {
      return
    }
    events.push({
      type: 'content_block_stop',
      index: blockIndex,
    } as BetaRawMessageStreamEvent)
    blockIndex++
    activeBlock = null
  }

  const drainPendingVisibleText = (
    final = false,
  ): BetaRawMessageStreamEvent[] => {
    const events: BetaRawMessageStreamEvent[] = []
    const options = {
      availableToolNames,
      parseBareJsonToolCalls: true,
    }

    while (pendingVisibleText) {
      if (looksLikeBareJsonToolCallPrefix(pendingVisibleText)) {
        const parsed = parseBareJsonToolCalls(pendingVisibleText, options)
        if (parsed.toolCalls.length > 0) {
          textToolCalls.push(...parsed.toolCalls)
          pendingVisibleText = parsed.text
          continue
        }
        if (!final) break
      }

      const newlineIdx = pendingVisibleText.indexOf('\n')
      if (newlineIdx === -1) break
      const line = pendingVisibleText.slice(0, newlineIdx + 1)
      pendingVisibleText = pendingVisibleText.slice(newlineIdx + 1)
      const parsed = parseBareJsonToolCalls(line, options)
      textToolCalls.push(...parsed.toolCalls)
      events.push(...textEvents(parsed.text))
    }

    if (final && pendingVisibleText) {
      const parsed = parseBareJsonToolCalls(pendingVisibleText, options)
      textToolCalls.push(...parsed.toolCalls)
      events.push(...textEvents(parsed.text))
      pendingVisibleText = ''
    } else if (
      pendingVisibleText &&
      !looksLikeBareJsonToolCallPrefix(pendingVisibleText)
    ) {
      events.push(...textEvents(pendingVisibleText))
      pendingVisibleText = ''
    }

    return events
  }

  for await (const chunk of readOllamaChunks(
    response,
    controller,
    getOllamaRequestTimeoutMs(options),
    options,
  )) {
    if (chunk.error) {
      throw new Error(chunk.error)
    }
    const thinkingDelta = chunk.message?.thinking ?? ''
    if (thinkingDelta) {
      thinking += thinkingDelta
      for (const event of thinkingEvents(thinkingDelta)) {
        yield event
      }
    }
    if (chunk.message?.tool_calls) {
      mergeToolCalls(toolCalls, chunk.message.tool_calls)
    }
    const deltaText = chunk.message?.content ?? ''
    if (deltaText) {
      text += deltaText
      if (!inToolSection) {
        const markerIdx = text.indexOf('<|tool_call')
        if (markerIdx !== -1) inToolSection = true
        const proseEnd = markerIdx === -1 ? text.length : markerIdx
        const toEmit = text.slice(emittedLen, proseEnd)
        if (toEmit) {
          emittedLen += toEmit.length
          pendingVisibleText += toEmit
          for (const event of drainPendingVisibleText()) {
            yield event
          }
        }
      }
    }
    if (chunk.done) {
      finalChunk = chunk
    }
  }

  for (const event of drainPendingVisibleText(true)) {
    yield event
  }

  if (activeBlock) {
    const events: BetaRawMessageStreamEvent[] = []
    stopActiveBlock(events)
    for (const event of events) {
      yield event
    }
  }

  // Convert any Kimi/ChatML text-form tool calls into real tool_use blocks so
  // they execute instead of leaking as text (which makes the agent stop early).
  const kimiParsed = parseKimiToolCalls(text)
  textToolCalls.push(...kimiParsed.toolCalls)

  // When the model wrote clarifying questions as plain prose instead of calling
  // AskUserQuestion, synthesize the tool call so the multiple-choice picker
  // renders (the streamed prose remains as a preamble).
  if (toolCalls.length === 0 && textToolCalls.length === 0) {
    const clarify = parseClarifyingQuestions(text, { availableToolNames })
    if (clarify) textToolCalls.push(clarify)
  }

  for (const call of toolCalls) {
    const rawName = call.function?.name
    if (!rawName) {
      continue
    }
    const name = reconcileToolName(rawName, availableToolNames)
    const input = stringifyToolInput(call.function?.arguments ?? {})
    yield {
      type: 'content_block_start',
      index: blockIndex,
      content_block: {
        type: 'tool_use',
        id: `toolu_ollama_${randomUUID().replace(/-/g, '')}`,
        name,
        input: {},
      },
    } as BetaRawMessageStreamEvent
    if (input) {
      yield {
        type: 'content_block_delta',
        index: blockIndex,
        delta: { type: 'input_json_delta', partial_json: input },
      } as BetaRawMessageStreamEvent
    }
    yield {
      type: 'content_block_stop',
      index: blockIndex,
    } as BetaRawMessageStreamEvent
    blockIndex++
  }

  // Emit tool_use blocks for the parsed text-form tool calls.
  for (const tc of textToolCalls) {
    yield {
      type: 'content_block_start',
      index: blockIndex,
      content_block: {
        type: 'tool_use',
        id: tc.id,
        name: reconcileToolName(tc.name, availableToolNames),
        input: {},
      },
    } as BetaRawMessageStreamEvent
    const inputJson = JSON.stringify(tc.input ?? {})
    if (inputJson && inputJson !== '{}') {
      yield {
        type: 'content_block_delta',
        index: blockIndex,
        delta: { type: 'input_json_delta', partial_json: inputJson },
      } as BetaRawMessageStreamEvent
    }
    yield {
      type: 'content_block_stop',
      index: blockIndex,
    } as BetaRawMessageStreamEvent
    blockIndex++
  }

  if (
    !textStarted &&
    !thinkingStarted &&
    toolCalls.length === 0 &&
    textToolCalls.length === 0
  ) {
    yield {
      type: 'content_block_start',
      index: blockIndex,
      content_block: { type: 'text', text: '' },
    } as BetaRawMessageStreamEvent
    yield {
      type: 'content_block_stop',
      index: blockIndex,
    } as BetaRawMessageStreamEvent
  }

  yield {
    type: 'message_delta',
    delta: {
      stop_reason: textToolCalls.length > 0 ? 'tool_use' : getStopReason(finalChunk, toolCalls),
      stop_sequence: null,
    },
    usage: usageFromOllama(finalChunk, text + thinking),
  } as BetaRawMessageStreamEvent

  yield {
    type: 'message_stop',
  } as BetaRawMessageStreamEvent
}

async function* readOllamaChunks(
  response: Response,
  controller: AbortController,
  timeoutMs: number,
  options?: RequestOptions,
): AsyncGenerator<OllamaChatChunk> {
  if (!response.body) {
    return
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : Infinity
  try {
    while (true) {
      const { done, value } = await readWithDeadline(
        reader,
        deadline,
        controller,
        options,
      )
      if (done) {
        break
      }
      buffer += decoder.decode(value, { stream: true })
      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        if (line) {
          yield JSON.parse(line) as OllamaChatChunk
        }
        newlineIndex = buffer.indexOf('\n')
      }
    }
    buffer += decoder.decode()
    const finalLine = buffer.trim()
    if (finalLine) {
      yield JSON.parse(finalLine) as OllamaChatChunk
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // A timed-out read may still be settling after the stream is aborted.
    }
  }
}

async function readWithDeadline(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  deadline: number,
  controller: AbortController,
  options?: RequestOptions,
): Promise<OllamaStreamReadResult> {
  if (!Number.isFinite(deadline)) {
    return reader.read()
  }
  if (controller.signal.aborted) {
    throw options?.signal?.aborted
      ? new APIUserAbortError()
      : new APIConnectionTimeoutError({ message: 'Ollama stream timed out' })
  }
  const remaining = deadline - Date.now()
  if (remaining <= 0) {
    controller.abort()
    throw new APIConnectionTimeoutError({ message: 'Ollama stream timed out' })
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      reader.read(),
      new Promise<OllamaStreamReadResult>((_, reject) => {
        timeoutId = setTimeout(() => {
          const error = new APIConnectionTimeoutError({
            message: 'Ollama stream timed out',
          })
          reject(error)
          controller.abort()
          void reader.cancel(error).catch(() => undefined)
        }, remaining)
      }),
    ])
  } catch (error) {
    if (controller.signal.aborted && options?.signal?.aborted) {
      throw new APIUserAbortError()
    }
    throw error
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

function ollamaResponseToURHQMessage(
  response: OllamaChatChunk,
  params: BetaMessageStreamParams,
): BetaMessage {
  const content: BetaContentBlock[] = []
  const structured = response.message?.tool_calls ?? []
  const thinking = response.message?.thinking ?? ''
  const availableToolNames = getAvailableToolNames(params.tools)
  const kimi = parseTextToolCalls(response.message?.content ?? '', {
    availableToolNames,
    parseBareJsonToolCalls: true,
  })
  const text = kimi.text
  // When clarifying questions arrived as plain prose instead of an
  // AskUserQuestion call, synthesize the tool call so the picker renders.
  const clarifyCall =
    structured.length === 0 && kimi.toolCalls.length === 0
      ? parseClarifyingQuestions(text, { availableToolNames })
      : null
  if (thinking) {
    content.push({
      type: 'thinking',
      thinking,
      signature: '',
    } as BetaContentBlock)
  }
  if (text || (!structured.length && !kimi.toolCalls.length)) {
    content.push({ type: 'text', text } as BetaContentBlock)
  }
  for (const call of structured) {
    const rawName = call.function?.name
    if (!rawName) {
      continue
    }
    content.push({
      type: 'tool_use',
      id: `toolu_ollama_${randomUUID().replace(/-/g, '')}`,
      name: reconcileToolName(rawName, availableToolNames),
      input: parseToolInput(call.function?.arguments ?? {}),
    } as BetaContentBlock)
  }
  for (const tc of kimi.toolCalls) {
    content.push({
      type: 'tool_use',
      id: tc.id,
      name: reconcileToolName(tc.name, availableToolNames),
      input: tc.input,
    } as BetaContentBlock)
  }
  if (clarifyCall) {
    content.push({
      type: 'tool_use',
      id: clarifyCall.id,
      name: clarifyCall.name,
      input: clarifyCall.input,
    } as BetaContentBlock)
  }

  return {
    id: `ollama-${randomUUID()}`,
    type: 'message',
    role: 'assistant',
    model: response.model ?? params.model,
    content,
    stop_reason:
      kimi.toolCalls.length > 0 || clarifyCall
        ? 'tool_use'
        : getStopReason(response, structured),
    stop_sequence: null,
    usage: usageFromOllama(response, text + thinking),
  } as BetaMessage
}

function mergeToolCalls(target: OllamaToolCall[], incoming: OllamaToolCall[]) {
  for (let i = 0; i < incoming.length; i++) {
    const current = incoming[i]
    if (!current) {
      continue
    }
    target[i] = {
      function: {
        name: current.function?.name ?? target[i]?.function?.name,
        arguments:
          current.function?.arguments ?? target[i]?.function?.arguments ?? {},
      },
    }
  }
}

function getStopReason(
  response: OllamaChatChunk | undefined,
  toolCalls: OllamaToolCall[],
): OllamaStopReason {
  if (toolCalls.some(call => call.function?.name)) {
    return 'tool_use'
  }
  return response?.done_reason === 'length' ? 'max_tokens' : 'end_turn'
}

function usageFromOllama(
  response: OllamaChatChunk | undefined,
  text: string,
): BetaUsage {
  const usage = emptyUsage()
  usage.input_tokens = response?.prompt_eval_count ?? 0
  usage.output_tokens =
    response?.eval_count ?? Math.max(1, Math.ceil(text.length / 4))
  return usage
}

function emptyUsage(): BetaUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
    service_tier: null,
    cache_creation: {
      ephemeral_1h_input_tokens: 0,
      ephemeral_5m_input_tokens: 0,
    },
  } as BetaUsage
}

function contentBlockToText(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    return content
      .map(block => {
        if (block && typeof block === 'object' && 'type' in block) {
          if (block.type === 'text' && 'text' in block) {
            return String(block.text)
          }
          if (block.type === 'image') {
            return '[Image output omitted]'
          }
        }
        return stringifyToolInput(block)
      })
      .join('\n')
  }
  return stringifyToolInput(content)
}

function estimateInputTokens(params: {
  messages?: MessageParam[]
  system?: BetaMessageStreamParams['system']
  tools?: BetaMessageStreamParams['tools']
}): number {
  const parts = [
    systemToText(params.system),
    ...(params.messages ?? []).map(messageToTokenText),
    JSON.stringify(toOllamaTools(params.tools)),
  ].filter(Boolean)

  const chars = parts.join('\n\n').length
  return Math.max(1, Math.ceil(chars / 4))
}

function messageToTokenText(message: MessageParam): string {
  const content = message.content
  if (typeof content === 'string') {
    return content
  }
  return content
    .map(block => {
      switch (block.type) {
        case 'text':
          return block.text
        case 'tool_use':
          return `${block.name} ${stringifyToolInput(block.input)}`
        case 'tool_result':
          return contentBlockToText(block.content)
        case 'image':
          return '[image]'
        case 'document':
          return '[document]'
        default:
          return stringifyToolInput(block)
      }
    })
    .join('\n')
}

function stringifyToolInput(input: unknown): string {
  if (typeof input === 'string') {
    return input
  }
  return JSON.stringify(input ?? {})
}

function parseToolInput(input: unknown): unknown {
  if (typeof input !== 'string') {
    return input ?? {}
  }
  try {
    return JSON.parse(input)
  } catch {
    return {}
  }
}
