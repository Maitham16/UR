import { randomUUID } from 'crypto'
import { ProviderResponseParseError } from './providerClient.js'
import {
  GEMINI_THOUGHT_SIGNATURE,
  getGeminiThoughtSignature,
} from './geminiWire.js'
export { getProviderRequestTimeoutMs } from './providerHttp.js'

type Usage = {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}

type StreamOptions = {
  controller?: AbortController
  signal?: AbortSignal
  model?: string
  requestId?: string
  providerName?: string
}

const EMPTY_USAGE: Usage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
}

function normalizeUsage(usage: any = {}): Usage {
  return {
    ...EMPTY_USAGE,
    ...usage,
  }
}

export function mergeAbortSignals(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const active = signals.filter(Boolean) as AbortSignal[]
  if (active.length === 0) return undefined
  if (active.length === 1) return active[0]

  const controller = new AbortController()
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      return controller.signal
    }
    signal.addEventListener(
      'abort',
      () => {
        if (!controller.signal.aborted) {
          controller.abort(signal.reason)
        }
      },
      { once: true },
    )
  }
  return controller.signal
}

export function createOpenAISSEMessageStream(body: unknown, options: StreamOptions = {}) {
  const controller = options.controller ?? new AbortController()
  const signal = mergeAbortSignals([controller.signal, options.signal])
  return {
    controller,
    async *[Symbol.asyncIterator]() {
      yield* streamOpenAIEvents(body, { ...options, controller, signal })
    },
  }
}

export function createAnthropicSSEMessageStream(body: unknown, options: StreamOptions = {}) {
  const controller = options.controller ?? new AbortController()
  const signal = mergeAbortSignals([controller.signal, options.signal])
  return {
    controller,
    async *[Symbol.asyncIterator]() {
      yield* streamAnthropicEvents(body, { ...options, controller, signal })
    },
  }
}

export function createGeminiSSEMessageStream(body: unknown, options: StreamOptions = {}) {
  const controller = options.controller ?? new AbortController()
  const signal = mergeAbortSignals([controller.signal, options.signal])
  return {
    controller,
    async *[Symbol.asyncIterator]() {
      yield* streamGeminiEvents(body, { ...options, controller, signal })
    },
  }
}

export function createBufferedMessageReplayStream(message: any) {
  const controller = new AbortController()
  const usage = normalizeUsage(message?.usage)
  const text = messageText(message)
  const model = message?.model ?? 'unknown'
  const id = message?.id ?? `provider-${randomUUID()}`
  const stopReason = message?.stop_reason ?? 'end_turn'

  return {
    controller,
    async *[Symbol.asyncIterator]() {
      yield messageStartEvent(id, model, { ...usage, output_tokens: 0 })
      yield {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      }
      if (text) {
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text },
        }
      }
      yield { type: 'content_block_stop', index: 0 }
      yield {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage,
      }
      yield { type: 'message_stop' }
    },
  }
}

async function* streamOpenAIEvents(
  body: unknown,
  options: StreamOptions,
): AsyncGenerator<any> {
  const providerName = options.providerName ?? 'openai'
  const id = options.requestId ?? `${providerName}-${randomUUID()}`
  const model = options.model ?? 'unknown'
  yield messageStartEvent(id, model, EMPTY_USAGE)

  let blockIndex = 0
  let activeTextIndex: number | null = null
  let sawBlock = false
  let sawToolUse = false
  let sawDone = false
  let finishReason: string | undefined
  let usage = EMPTY_USAGE
  const toolStates = new Map<number, {
    blockIndex?: number
    id?: string
    name?: string
    pendingArgs: string
  }>()

  let activeThinkingIndex: number | null = null

  const stopThinking = function* () {
    if (activeThinkingIndex !== null) {
      yield { type: 'content_block_stop', index: activeThinkingIndex }
      activeThinkingIndex = null
    }
  }

  const stopText = function* () {
    if (activeTextIndex !== null) {
      yield { type: 'content_block_stop', index: activeTextIndex }
      activeTextIndex = null
    }
  }

  const ensureText = function* () {
    if (activeTextIndex === null) {
      for (const event of stopThinking()) yield event
      activeTextIndex = blockIndex++
      sawBlock = true
      yield {
        type: 'content_block_start',
        index: activeTextIndex,
        content_block: { type: 'text', text: '' },
      }
    }
  }

  // Reasoning models served over the OpenAI-compatible API (LM Studio, vLLM)
  // stream chain-of-thought in `delta.reasoning_content` (or `delta.reasoning`)
  // rather than `delta.content`. Surface it as a thinking block so models that
  // put their output there don't render as an empty response.
  const ensureThinking = function* () {
    if (activeThinkingIndex === null) {
      for (const event of stopText()) yield event
      activeThinkingIndex = blockIndex++
      sawBlock = true
      yield {
        type: 'content_block_start',
        index: activeThinkingIndex,
        content_block: { type: 'thinking', thinking: '' },
      }
    }
  }

  const ensureTool = function* (state: {
    blockIndex?: number
    id?: string
    name?: string
    pendingArgs: string
  }) {
    if (state.blockIndex !== undefined) return
    if (!state.name) return
    for (const event of stopText()) yield event
    state.blockIndex = blockIndex++
    state.id = state.id ?? `toolu_${providerName}_${randomUUID().replace(/-/g, '')}`
    sawBlock = true
    sawToolUse = true
    yield {
      type: 'content_block_start',
      index: state.blockIndex,
      content_block: {
        type: 'tool_use',
        id: state.id,
        name: state.name,
        input: {},
      },
    }
    if (state.pendingArgs) {
      yield {
        type: 'content_block_delta',
        index: state.blockIndex,
        delta: { type: 'input_json_delta', partial_json: state.pendingArgs },
      }
      state.pendingArgs = ''
    }
  }

  for await (const payload of readSSEData(body, options.signal)) {
    if (payload === '[DONE]') {
      sawDone = true
      break
    }
    const chunk = parseJSONPayload(payload, `${providerName} SSE chunk`)
    throwProviderPayloadError(chunk, providerName)
    if (chunk?.usage) {
      usage = usageFromOpenAI(chunk.usage)
    }
    for (const choice of chunk?.choices ?? []) {
      const delta = choice?.delta ?? {}
      const reasoning =
        typeof delta.reasoning_content === 'string'
          ? delta.reasoning_content
          : typeof delta.reasoning === 'string'
            ? delta.reasoning
            : ''
      if (reasoning.length > 0) {
        for (const event of ensureThinking()) yield event
        yield {
          type: 'content_block_delta',
          index: activeThinkingIndex,
          delta: { type: 'thinking_delta', thinking: reasoning },
        }
      }
      if (typeof delta.content === 'string' && delta.content.length > 0) {
        for (const event of ensureText()) yield event
        yield {
          type: 'content_block_delta',
          index: activeTextIndex,
          delta: { type: 'text_delta', text: delta.content },
        }
      }
      for (const toolDelta of delta.tool_calls ?? []) {
        const index = Number.isInteger(toolDelta?.index) ? toolDelta.index : 0
        const state = toolStates.get(index) ?? { pendingArgs: '' }
        toolStates.set(index, state)
        if (typeof toolDelta.id === 'string' && toolDelta.id.length > 0) {
          state.id = toolDelta.id
        }
        if (
          typeof toolDelta.function?.name === 'string' &&
          toolDelta.function.name.length > 0
        ) {
          state.name = toolDelta.function.name
        }
        if (
          typeof toolDelta.function?.arguments === 'string' &&
          toolDelta.function.arguments.length > 0
        ) {
          if (state.blockIndex === undefined) {
            state.pendingArgs += toolDelta.function.arguments
          } else {
            yield {
              type: 'content_block_delta',
              index: state.blockIndex,
              delta: {
                type: 'input_json_delta',
                partial_json: toolDelta.function.arguments,
              },
            }
          }
        }
        for (const event of ensureTool(state)) yield event
      }
      if (choice?.finish_reason) {
        finishReason = choice.finish_reason
      }
    }
  }

  for (const event of stopText()) yield event
  for (const event of stopThinking()) yield event
  for (const [index, state] of toolStates.entries()) {
    if (state.blockIndex === undefined) {
      throw new ProviderResponseParseError(
        `${providerName} streamed tool_calls[${index}] without a function name`,
        { state },
      )
    }
    yield { type: 'content_block_stop', index: state.blockIndex }
  }
  if (isOpenAIToolStopReason(finishReason) && !sawToolUse) {
    throw new ProviderResponseParseError(
      `${providerName} stream finished with ${finishReason} but did not include a tool call`,
    )
  }
  if (!sawBlock) {
    throw new ProviderResponseParseError(`${providerName} stream completed without content`, {
      finishReason,
      sawDone,
    })
  }
  if (!sawDone && finishReason === undefined) {
    throw new ProviderResponseParseError(`${providerName} stream ended before a terminal event`)
  }
  yield {
    type: 'message_delta',
    delta: {
      stop_reason: mapOpenAIStreamStopReason(finishReason, sawToolUse),
      stop_sequence: null,
    },
    usage,
  }
  yield { type: 'message_stop' }
}

async function* streamAnthropicEvents(
  body: unknown,
  options: StreamOptions,
): AsyncGenerator<any> {
  const providerName = options.providerName ?? 'anthropic'
  let sawMessageStart = false
  let sawMessageStop = false

  for await (const payload of readSSEData(body, options.signal)) {
    if (payload === '[DONE]') break
    const event = parseJSONPayload(payload, `${providerName} SSE event`)
    if (!event || event.type === 'ping') continue
    throwProviderPayloadError(event, providerName)
    if (!sawMessageStart && event.type !== 'message_start') {
      sawMessageStart = true
      yield messageStartEvent(
        options.requestId ?? `${providerName}-${randomUUID()}`,
        options.model ?? 'unknown',
        EMPTY_USAGE,
      )
    }
    if (event.type === 'message_start') {
      sawMessageStart = true
      yield {
        ...event,
        message: {
          ...event.message,
          id: event.message?.id ?? options.requestId ?? `${providerName}-${randomUUID()}`,
          model: event.message?.model ?? options.model ?? 'unknown',
          usage: normalizeUsage(event.message?.usage),
        },
      }
      continue
    }
    if (event.type === 'message_delta') {
      yield {
        ...event,
        delta: {
          stop_reason: event.delta?.stop_reason ?? 'end_turn',
          stop_sequence: event.delta?.stop_sequence ?? null,
        },
        usage: normalizeUsage(event.usage),
      }
      continue
    }
    if (event.type === 'message_stop') {
      sawMessageStop = true
    }
    yield event
  }

  if (!sawMessageStart) {
    throw new ProviderResponseParseError(`${providerName} stream completed without message_start`)
  }
  if (!sawMessageStop) {
    throw new ProviderResponseParseError(`${providerName} stream ended before message_stop`)
  }
}

async function* streamGeminiEvents(
  body: unknown,
  options: StreamOptions,
): AsyncGenerator<any> {
  const providerName = options.providerName ?? 'gemini'
  yield messageStartEvent(
    options.requestId ?? `${providerName}-${randomUUID()}`,
    options.model ?? 'unknown',
    EMPTY_USAGE,
  )

  let blockIndex = 0
  let activeTextIndex: number | null = null
  let activeThinkingIndex: number | null = null
  let sawBlock = false
  let sawToolUse = false
  let finishReason: string | undefined
  let usage = EMPTY_USAGE

  const stopText = function* () {
    if (activeTextIndex !== null) {
      yield { type: 'content_block_stop', index: activeTextIndex }
      activeTextIndex = null
    }
  }

  const stopThinking = function* () {
    if (activeThinkingIndex !== null) {
      yield { type: 'content_block_stop', index: activeThinkingIndex }
      activeThinkingIndex = null
    }
  }

  const ensureText = function* () {
    if (activeTextIndex === null) {
      for (const event of stopThinking()) yield event
      activeTextIndex = blockIndex++
      sawBlock = true
      yield {
        type: 'content_block_start',
        index: activeTextIndex,
        content_block: { type: 'text', text: '' },
      }
    }
  }

  const ensureThinking = function* () {
    if (activeThinkingIndex === null) {
      for (const event of stopText()) yield event
      activeThinkingIndex = blockIndex++
      sawBlock = true
      yield {
        type: 'content_block_start',
        index: activeThinkingIndex,
        content_block: { type: 'thinking', thinking: '', signature: '' },
      }
    }
  }

  const emitSignedTextPart = function* (
    part: any,
    thoughtSignature: string,
  ) {
    for (const event of stopText()) yield event
    for (const event of stopThinking()) yield event
    const currentIndex = blockIndex++
    const isThought = part.thought === true
    sawBlock = true
    yield {
      type: 'content_block_start',
      index: currentIndex,
      content_block: isThought
        ? {
          type: 'thinking',
          thinking: '',
          signature: '',
          [GEMINI_THOUGHT_SIGNATURE]: thoughtSignature,
        }
        : {
          type: 'text',
          text: '',
          [GEMINI_THOUGHT_SIGNATURE]: thoughtSignature,
        },
    }
    if (part.text.length > 0) {
      yield {
        type: 'content_block_delta',
        index: currentIndex,
        delta: isThought
          ? { type: 'thinking_delta', thinking: part.text }
          : { type: 'text_delta', text: part.text },
      }
    }
    yield { type: 'content_block_stop', index: currentIndex }
  }

  for await (const payload of readSSEData(body, options.signal)) {
    if (payload === '[DONE]') break
    const parsed = parseJSONPayload(payload, `${providerName} SSE chunk`)
    const chunks = Array.isArray(parsed) ? parsed : [parsed]
    for (const chunk of chunks) {
      if (chunk?.usageMetadata) {
        usage = usageFromGemini(chunk.usageMetadata)
      }
      throwProviderPayloadError(chunk, providerName)
      for (const candidate of chunk?.candidates ?? []) {
        for (const part of candidate?.content?.parts ?? []) {
          const thoughtSignature = getGeminiThoughtSignature(part)
          if (typeof part?.text === 'string' && thoughtSignature) {
            for (const event of emitSignedTextPart(part, thoughtSignature)) yield event
          } else if (typeof part?.text === 'string' && part.text.length > 0) {
            if (part.thought === true) {
              for (const event of ensureThinking()) yield event
              yield {
                type: 'content_block_delta',
                index: activeThinkingIndex,
                delta: { type: 'thinking_delta', thinking: part.text },
              }
            } else {
              for (const event of ensureText()) yield event
              yield {
                type: 'content_block_delta',
                index: activeTextIndex,
                delta: { type: 'text_delta', text: part.text },
              }
            }
          }
          if (part?.functionCall !== undefined) {
            for (const event of stopText()) yield event
            for (const event of stopThinking()) yield event
            const call = part.functionCall
            if (typeof call?.name !== 'string' || call.name.length === 0) {
              throw new ProviderResponseParseError(
                'gemini streamed functionCall without a name',
                { functionCall: call },
              )
            }
            const currentIndex = blockIndex++
            sawBlock = true
            sawToolUse = true
            yield {
              type: 'content_block_start',
              index: currentIndex,
              content_block: {
                type: 'tool_use',
                id: typeof call.id === 'string' && call.id.length > 0
                  ? call.id
                  : `gemini_tool_${randomUUID().replace(/-/g, '')}`,
                name: call.name,
                input: {},
                ...(thoughtSignature && {
                  [GEMINI_THOUGHT_SIGNATURE]: thoughtSignature,
                }),
              },
            }
            const inputJson = stringifyToolInput(call.args ?? {})
            if (inputJson && inputJson !== '{}') {
              yield {
                type: 'content_block_delta',
                index: currentIndex,
                delta: { type: 'input_json_delta', partial_json: inputJson },
              }
            }
            yield { type: 'content_block_stop', index: currentIndex }
          }
        }
        if (candidate?.finishReason) {
          finishReason = candidate.finishReason
        }
      }
    }
  }

  for (const event of stopText()) yield event
  for (const event of stopThinking()) yield event
  if (finishReason === 'FUNCTION_CALL' && !sawToolUse) {
    throw new ProviderResponseParseError(
      'gemini stream finished with FUNCTION_CALL but did not include a functionCall part',
    )
  }
  if (!sawBlock) {
    throw new ProviderResponseParseError(`${providerName} stream completed without content`, {
      finishReason,
    })
  }
  if (finishReason === undefined) {
    throw new ProviderResponseParseError(`${providerName} stream ended before a terminal event`)
  }
  yield {
    type: 'message_delta',
    delta: {
      stop_reason: mapGeminiStopReason(finishReason, sawToolUse),
      stop_sequence: null,
    },
    usage,
  }
  yield { type: 'message_stop' }
}

async function* readSSEData(
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  let buffer = ''
  for await (const chunk of readTextChunks(body, signal)) {
    buffer += chunk
    while (true) {
      const delimiter = findSSEDelimiter(buffer)
      if (!delimiter) break
      const rawEvent = buffer.slice(0, delimiter.index)
      buffer = buffer.slice(delimiter.index + delimiter.length)
      const data = parseSSEEvent(rawEvent)
      if (data !== undefined) yield data
    }
  }
  if (buffer.trim()) {
    const data = parseSSEEvent(buffer)
    if (data !== undefined) yield data
  }
}

async function* readTextChunks(
  body: any,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  throwIfAborted(signal)
  if (!body) return
  if (typeof body === 'string') {
    yield body
    return
  }

  const decoder = new TextDecoder()
  if (typeof body.getReader === 'function') {
    const reader = body.getReader()
    try {
      while (true) {
        throwIfAborted(signal)
        const { value, done } = await reader.read()
        if (done) break
        if (value !== undefined) {
          yield decoder.decode(value, { stream: true })
        }
      }
      const trailing = decoder.decode()
      if (trailing) yield trailing
    } finally {
      if (signal?.aborted) {
        await reader.cancel().catch(() => undefined)
      }
    }
    return
  }

  if (typeof body[Symbol.asyncIterator] === 'function') {
    for await (const chunk of body as AsyncIterable<unknown>) {
      throwIfAborted(signal)
      yield decodeChunk(chunk, decoder)
    }
    const trailing = decoder.decode()
    if (trailing) yield trailing
    return
  }

  if (body.body) {
    yield* readTextChunks(body.body, signal)
  }
}

function findSSEDelimiter(buffer: string): { index: number; length: number } | null {
  const lf = buffer.indexOf('\n\n')
  const crlf = buffer.indexOf('\r\n\r\n')
  if (lf === -1 && crlf === -1) return null
  if (lf === -1) return { index: crlf, length: 4 }
  if (crlf === -1) return { index: lf, length: 2 }
  return lf < crlf ? { index: lf, length: 2 } : { index: crlf, length: 4 }
}

function parseSSEEvent(rawEvent: string): string | undefined {
  const dataLines: string[] = []
  for (const rawLine of rawEvent.replace(/\r/g, '').split('\n')) {
    const line = rawLine.trimEnd()
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
    }
  }
  if (dataLines.length === 0) return undefined
  return dataLines.join('\n')
}

function parseJSONPayload(payload: string, label: string): any {
  try {
    return JSON.parse(payload)
  } catch (error) {
    throw new ProviderResponseParseError(`${label} is not valid JSON`, {
      payload,
      cause: error,
    })
  }
}

function throwProviderPayloadError(payload: any, providerName: string): void {
  const error = payload?.error ?? (payload?.type === 'error' ? payload : undefined)
  if (!error) return
  const detail =
    typeof error === 'string'
      ? error
      : typeof error?.message === 'string'
        ? error.message
        : typeof error?.error?.message === 'string'
          ? error.error.message
          : JSON.stringify(error)
  throw new ProviderResponseParseError(`${providerName} stream returned an error: ${detail}`, {
    payload,
  })
}

function decodeChunk(chunk: unknown, decoder: TextDecoder): string {
  if (typeof chunk === 'string') return chunk
  if (chunk instanceof Uint8Array) return decoder.decode(chunk, { stream: true })
  return String(chunk ?? '')
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new Error('Provider stream aborted')
  }
}

function messageStartEvent(id: string, model: string, usage: Usage): any {
  return {
    type: 'message_start',
    message: {
      id,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage,
    },
  }
}

function messageText(message: any): string {
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(block => {
      if (typeof block === 'string') return block
      if (block?.type === 'text') return block.text ?? ''
      return ''
    })
    .join('')
}

function usageFromOpenAI(usage: any): Usage {
  return normalizeUsage({
    input_tokens: usage?.prompt_tokens ?? 0,
    output_tokens: usage?.completion_tokens ?? 0,
  })
}

function usageFromGemini(usage: any): Usage {
  return normalizeUsage({
    input_tokens: usage?.promptTokenCount ?? 0,
    output_tokens: usage?.candidatesTokenCount ?? 0,
  })
}

function isOpenAIToolStopReason(reason: string | undefined): boolean {
  return reason === 'tool_calls' || reason === 'function_call' || reason === 'tool_use'
}

function mapOpenAIStreamStopReason(
  reason: string | undefined,
  includesToolUse: boolean,
): string {
  if (includesToolUse || isOpenAIToolStopReason(reason)) return 'tool_use'
  if (reason === 'length') return 'max_tokens'
  return 'end_turn'
}

function mapGeminiStopReason(reason: string | undefined, includesToolUse: boolean): string {
  if (includesToolUse || reason === 'FUNCTION_CALL') return 'tool_use'
  if (reason === 'MAX_TOKENS') return 'max_tokens'
  return 'end_turn'
}

function stringifyToolInput(input: unknown): string {
  if (typeof input === 'string') return input
  return JSON.stringify(input ?? {})
}
