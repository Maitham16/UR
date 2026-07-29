import { randomUUID } from 'crypto'
import {
  isProviderToolInput,
  ProviderResponseParseError,
} from './providerClient.js'
import { parseToolInputJsonLenient } from '../../utils/json.js'
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
  onEvent?: (event: any) => void
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

/**
 * Convert OpenAI Responses API semantic SSE events into the Anthropic-shaped
 * stream contract consumed by the rest of UR. Raw events remain available via
 * `onEvent`, which is also used to durably checkpoint background-stream cursors.
 */
export function createOpenAIResponsesSSEMessageStream(
  body: unknown,
  options: StreamOptions = {},
) {
  const controller = options.controller ?? new AbortController()
  const signal = mergeAbortSignals([controller.signal, options.signal])
  return {
    controller,
    async *[Symbol.asyncIterator]() {
      yield* streamOpenAIResponsesEvents(body, {
        ...options,
        controller,
        signal,
      })
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
  const emittedToolIds = new Set<string>()
  const toolStates = new Map<number, {
    blockIndex?: number
    id?: string
    name?: string
    pendingArgs: string
    allArgs: string
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
    allArgs: string
  }, final = false) {
    if (state.blockIndex !== undefined) return
    if (!state.name) return
    // Do not synthesize an ID while more deltas may still carry the provider's
    // real one. Emitting a fallback first makes later tool_result correlation
    // impossible because content_block_start is immutable.
    if (!state.id && !final) return
    for (const event of stopText()) yield event
    state.blockIndex = blockIndex++
    state.id = state.id ?? `toolu_${providerName}_${randomUUID().replace(/-/g, '')}`
    if (emittedToolIds.has(state.id)) {
      throw new ProviderResponseParseError(
        `${providerName} stream contains duplicate tool call id "${state.id}"`,
      )
    }
    emittedToolIds.add(state.id)
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
      if (
        delta.tool_calls !== undefined &&
        !Array.isArray(delta.tool_calls)
      ) {
        throw new ProviderResponseParseError(
          `${providerName} streamed tool_calls must be an array`,
          { toolCalls: delta.tool_calls },
        )
      }
      for (const toolDelta of delta.tool_calls ?? []) {
        if (
          toolDelta?.type !== undefined &&
          toolDelta.type !== 'function'
        ) {
          throw new ProviderResponseParseError(
            `${providerName} streamed an unsupported tool call type`,
            { toolDelta },
          )
        }
        const index = Number.isInteger(toolDelta?.index) ? toolDelta.index : 0
        if (index < 0) {
          throw new ProviderResponseParseError(
            `${providerName} streamed a negative tool call index`,
            { toolDelta },
          )
        }
        const state = toolStates.get(index) ?? {
          pendingArgs: '',
          allArgs: '',
        }
        toolStates.set(index, state)
        if (typeof toolDelta.id === 'string' && toolDelta.id.length > 0) {
          if (state.id && state.id !== toolDelta.id) {
            throw new ProviderResponseParseError(
              `${providerName} changed the id for streamed tool_calls[${index}]`,
              { previousId: state.id, toolDelta },
            )
          }
          state.id = toolDelta.id
        }
        if (
          typeof toolDelta.function?.name === 'string' &&
          toolDelta.function.name.length > 0
        ) {
          const fragment = toolDelta.function.name
          if (!state.name) {
            state.name = fragment
          } else if (fragment === state.name) {
            // Cumulative resend.
          } else if (fragment.startsWith(state.name)) {
            state.name = fragment
          } else {
            state.name += fragment
          }
        }
        if (
          typeof toolDelta.function?.arguments === 'string' &&
          toolDelta.function.arguments.length > 0
        ) {
          state.allArgs += toolDelta.function.arguments
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
    for (const event of ensureTool(state, true)) yield event
    if (state.blockIndex === undefined) {
      throw new ProviderResponseParseError(
        `${providerName} streamed tool_calls[${index}] without a function name`,
        { state },
      )
    }
    parseStreamedToolInput(
      state.allArgs,
      `${providerName} streamed tool_calls[${index}].function.arguments`,
    )
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

async function* streamOpenAIResponsesEvents(
  body: unknown,
  options: StreamOptions,
): AsyncGenerator<any> {
  const providerName = options.providerName ?? 'openai-responses'
  let responseId = options.requestId ?? `${providerName}-${randomUUID()}`
  let model = options.model ?? 'unknown'
  let started = false
  let terminal = false
  let sawToolUse = false
  let usage = EMPTY_USAGE
  let blockIndex = 0
  let stopReason = 'end_turn'
  const toolIds = new Set<string>()
  const blocks = new Map<string, {
    index: number
    kind: 'text' | 'thinking' | 'tool_use'
    emitted: string
    stopped: boolean
    toolId?: string
    toolName?: string
  }>()

  const ensureMessageStart = function* () {
    if (started) return
    started = true
    yield messageStartEvent(responseId, model, EMPTY_USAGE)
  }

  const ensureBlock = function* (
    key: string,
    kind: 'text' | 'thinking' | 'tool_use',
    item?: any,
  ) {
    let state = blocks.get(key)
    if (state) {
      if (
        kind === 'tool_use' &&
        item &&
        ((item.call_id && item.call_id !== state.toolId) ||
          (item.name && item.name !== state.toolName))
      ) {
        throw new ProviderResponseParseError(
          `${providerName} changed a streamed function call after it started`,
          { item, state },
        )
      }
      return state
    }
    for (const event of ensureMessageStart()) yield event
    state = { index: blockIndex++, kind, emitted: '', stopped: false }
    blocks.set(key, state)
    if (kind === 'tool_use') {
      if (
        typeof item?.call_id !== 'string' ||
        item.call_id.length === 0 ||
        typeof item?.name !== 'string' ||
        item.name.length === 0
      ) {
        throw new ProviderResponseParseError(
          `${providerName} streamed a function call without call_id or name`,
          { item },
        )
      }
      if (toolIds.has(item.call_id)) {
        throw new ProviderResponseParseError(
          `${providerName} stream contains duplicate tool call id "${item.call_id}"`,
          { item },
        )
      }
      toolIds.add(item.call_id)
      state.toolId = item.call_id
      state.toolName = item.name
      sawToolUse = true
      yield {
        type: 'content_block_start',
        index: state.index,
        content_block: {
          type: 'tool_use',
          id: item.call_id,
          name: item.name,
          input: {},
          ...(item?.namespace ? { namespace: item.namespace } : {}),
        },
      }
    } else if (kind === 'thinking') {
      yield {
        type: 'content_block_start',
        index: state.index,
        content_block: { type: 'thinking', thinking: '' },
      }
    } else {
      yield {
        type: 'content_block_start',
        index: state.index,
        content_block: { type: 'text', text: '' },
      }
    }
    return state
  }

  const stopBlock = function* (key: string) {
    const state = blocks.get(key)
    if (!state || state.stopped) return
    if (state.kind === 'tool_use') {
      parseStreamedToolInput(
        state.emitted,
        `${providerName} streamed function call arguments`,
      )
    }
    state.stopped = true
    yield { type: 'content_block_stop', index: state.index }
  }

  const emitText = function* (
    key: string,
    text: string,
    kind: 'text' | 'thinking',
  ) {
    if (!text) return
    let state = blocks.get(key)
    if (!state) {
      for (const event of ensureBlock(key, kind)) yield event
      state = blocks.get(key)!
    }
    state.emitted += text
    yield {
      type: 'content_block_delta',
      index: state.index,
      delta: kind === 'thinking'
        ? { type: 'thinking_delta', thinking: text }
        : { type: 'text_delta', text },
    }
  }

  for await (const payload of readSSEData(body, options.signal)) {
    if (payload === '[DONE]') break
    const event = parseJSONPayload(payload, `${providerName} SSE event`)
    options.onEvent?.(event)
    throwProviderPayloadError(event, providerName)
    if (event?.response?.id) responseId = event.response.id
    if (event?.response?.model) model = event.response.model
    if (event?.response?.usage) usage = usageFromOpenAIResponses(event.response.usage)

    const outputIndex = Number.isInteger(event?.output_index) ? event.output_index : 0
    const contentIndex = Number.isInteger(event?.content_index) ? event.content_index : 0
    const textKey = `text:${outputIndex}:${contentIndex}`
    const thinkingKey = `thinking:${outputIndex}:${contentIndex}`
    const toolKey = `tool:${outputIndex}`

    switch (event?.type) {
      case 'response.created':
      case 'response.queued':
      case 'response.in_progress':
        for (const output of ensureMessageStart()) yield output
        break
      case 'response.output_text.delta':
      case 'response.refusal.delta':
        for (const output of emitText(
          textKey,
          String(event.delta ?? ''),
          'text',
        )) yield output
        break
      case 'response.output_text.done':
      case 'response.refusal.done': {
        const finalText = String(event.text ?? event.refusal ?? '')
        if (!blocks.get(textKey)?.emitted && finalText) {
          for (const output of emitText(textKey, finalText, 'text')) yield output
        }
        for (const output of stopBlock(textKey)) yield output
        break
      }
      case 'response.reasoning_summary_text.delta':
      case 'response.reasoning_text.delta':
        for (const output of emitText(
          thinkingKey,
          String(event.delta ?? ''),
          'thinking',
        )) yield output
        break
      case 'response.reasoning_summary_text.done':
      case 'response.reasoning_text.done': {
        const finalThinking = String(event.text ?? '')
        if (!blocks.get(thinkingKey)?.emitted && finalThinking) {
          for (const output of emitText(thinkingKey, finalThinking, 'thinking')) yield output
        }
        for (const output of stopBlock(thinkingKey)) yield output
        break
      }
      case 'response.output_item.added':
        if (event.item?.type === 'function_call') {
          for (const output of ensureBlock(toolKey, 'tool_use', event.item)) yield output
        }
        break
      case 'response.function_call_arguments.delta': {
        let state = blocks.get(toolKey)
        if (!state) {
          throw new ProviderResponseParseError(
            `${providerName} streamed function arguments before the function call item`,
            { event },
          )
        }
        const delta = String(event.delta ?? '')
        state.emitted += delta
        if (delta) {
          yield {
            type: 'content_block_delta',
            index: state.index,
            delta: { type: 'input_json_delta', partial_json: delta },
          }
        }
        break
      }
      case 'response.output_item.done':
        if (event.item?.type === 'function_call') {
          for (const output of ensureBlock(
            toolKey,
            'tool_use',
            event.item,
          )) yield output
          const state = blocks.get(toolKey)!
          const args = String(event.item.arguments ?? '')
          if (!state.emitted && args) {
            state.emitted = args
            yield {
              type: 'content_block_delta',
              index: state.index,
              delta: { type: 'input_json_delta', partial_json: args },
            }
          } else if (args && args !== state.emitted) {
            throw new ProviderResponseParseError(
              `${providerName} changed streamed function arguments in the completed item`,
              { streamed: state.emitted, completed: args },
            )
          }
          for (const output of stopBlock(toolKey)) yield output
        }
        break
      case 'response.completed':
      case 'response.incomplete':
      case 'response.failed':
      case 'response.cancelled': {
        if (event.type === 'response.failed') {
          const detail = event.response?.error?.message ?? 'response failed'
          throw new ProviderResponseParseError(`${providerName} failed: ${detail}`, { event })
        }
        if (event.type === 'response.cancelled') {
          throw new ProviderResponseParseError(
            `${providerName} response was cancelled before completion`,
            { event },
          )
        }
        terminal = true
        const reason = event.response?.incomplete_details?.reason
        if (
          event.type === 'response.incomplete' &&
          reason !== 'max_output_tokens'
        ) {
          throw new ProviderResponseParseError(
            `${providerName} response was incomplete: ${String(reason ?? 'unknown reason')}`,
            { event },
          )
        }
        stopReason = sawToolUse
          ? 'tool_use'
          : reason === 'max_output_tokens'
            ? 'max_tokens'
            : 'end_turn'
        break
      }
      default:
        break
    }
    if (terminal) break
  }

  if (!terminal) {
    throw new ProviderResponseParseError(`${providerName} stream ended before a terminal event`)
  }
  for (const output of ensureMessageStart()) yield output
  if (blocks.size === 0) {
    for (const output of ensureBlock('text:0:0', 'text')) yield output
  }
  for (const [key] of blocks) {
    for (const output of stopBlock(key)) yield output
  }
  yield {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
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
  let stopReason: string | undefined
  let sawToolUse = false
  const openBlocks = new Set<number>()
  const toolIds = new Set<string>()
  const streamedToolInputs = new Map<number, string>()

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
      stopReason = event.delta?.stop_reason
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
    if (event.type === 'content_block_start') {
      if (
        !Number.isInteger(event.index) ||
        event.index < 0 ||
        openBlocks.has(event.index)
      ) {
        throw new ProviderResponseParseError(
          `${providerName} stream contains an invalid or duplicate content block index`,
          { event },
        )
      }
      openBlocks.add(event.index)
      if (event.content_block?.type === 'tool_use') {
        const block = event.content_block
        if (
          typeof block.id !== 'string' ||
          block.id.length === 0 ||
          typeof block.name !== 'string' ||
          block.name.length === 0 ||
          !isProviderToolInput(block.input ?? {})
        ) {
          throw new ProviderResponseParseError(
            `${providerName} stream contains an invalid tool_use block`,
            { event },
          )
        }
        if (toolIds.has(block.id)) {
          throw new ProviderResponseParseError(
            `${providerName} stream contains duplicate tool call id "${block.id}"`,
            { event },
          )
        }
        toolIds.add(block.id)
        streamedToolInputs.set(event.index, '')
        sawToolUse = true
      }
    } else if (event.type === 'content_block_delta') {
      if (!openBlocks.has(event.index)) {
        throw new ProviderResponseParseError(
          `${providerName} streamed a delta for an unopened content block`,
          { event },
        )
      }
      if (
        streamedToolInputs.has(event.index) &&
        event.delta?.type === 'input_json_delta'
      ) {
        if (typeof event.delta.partial_json !== 'string') {
          throw new ProviderResponseParseError(
            `${providerName} streamed a non-string tool input delta`,
            { event },
          )
        }
        streamedToolInputs.set(
          event.index,
          streamedToolInputs.get(event.index)! + event.delta.partial_json,
        )
      }
    } else if (event.type === 'content_block_stop') {
      if (!openBlocks.delete(event.index)) {
        throw new ProviderResponseParseError(
          `${providerName} stopped an unopened content block`,
          { event },
        )
      }
      const streamedInput = streamedToolInputs.get(event.index)
      if (streamedInput !== undefined) {
        parseStreamedToolInput(
          streamedInput,
          `${providerName} streamed tool_use input`,
        )
        streamedToolInputs.delete(event.index)
      }
    }
    if (event.type === 'message_stop') {
      if (openBlocks.size > 0) {
        throw new ProviderResponseParseError(
          `${providerName} stopped with unfinished content blocks`,
          { openBlocks: [...openBlocks] },
        )
      }
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
  if (stopReason === 'tool_use' && !sawToolUse) {
    throw new ProviderResponseParseError(
      `${providerName} stream stopped for tool_use without a tool_use block`,
    )
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
  const geminiToolCalls = new Map<string, string>()

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
            const args = parseStreamedToolInput(
              call.args ?? {},
              'gemini streamed functionCall.args',
            )
            const explicitId =
              typeof call.id === 'string' && call.id.length > 0
                ? call.id
                : undefined
            if (explicitId) {
              const signature = `${call.name}\u0000${canonicalJson(args)}`
              const previous = geminiToolCalls.get(explicitId)
              if (previous === signature) {
                // Some proxies resend cumulative candidate parts. Executing
                // the same functionCall twice would duplicate mutations.
                continue
              }
              if (previous !== undefined) {
                throw new ProviderResponseParseError(
                  `gemini stream reused tool call id "${explicitId}" for different calls`,
                  { functionCall: call },
                )
              }
              geminiToolCalls.set(explicitId, signature)
            }
            const currentIndex = blockIndex++
            sawBlock = true
            sawToolUse = true
            yield {
              type: 'content_block_start',
              index: currentIndex,
              content_block: {
                type: 'tool_use',
                id: explicitId
                  ? explicitId
                  : `gemini_tool_${randomUUID().replace(/-/g, '')}`,
                name: call.name,
                input: {},
                ...(thoughtSignature && {
                  [GEMINI_THOUGHT_SIGNATURE]: thoughtSignature,
                }),
              },
            }
            const inputJson = stringifyToolInput(args)
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

function usageFromOpenAIResponses(usage: any): Usage {
  return normalizeUsage({
    input_tokens: usage?.input_tokens ?? 0,
    output_tokens: usage?.output_tokens ?? 0,
    cache_creation_input_tokens:
      usage?.input_tokens_details?.cache_write_tokens ?? 0,
    cache_read_input_tokens:
      usage?.input_tokens_details?.cached_tokens ?? 0,
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

function parseStreamedToolInput(input: unknown, path: string): Record<string, unknown> {
  let parsed = input
  if (typeof input === 'string') {
    try {
      parsed = input.length > 0 ? JSON.parse(input) : {}
    } catch (error) {
      parsed = parseToolInputJsonLenient(input)
      if (parsed === null) {
        throw new ProviderResponseParseError(`${path} is not valid JSON`, {
          input,
          cause: error,
        })
      }
    }
  }
  if (!isProviderToolInput(parsed)) {
    throw new ProviderResponseParseError(`${path} must be a JSON object`, {
      input,
    })
  }
  return parsed
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  if (isProviderToolInput(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
