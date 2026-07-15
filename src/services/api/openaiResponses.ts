import { randomUUID } from 'node:crypto'
import {
  contentToText,
  estimateProviderInputTokens,
  mapOpenAIToolChoice,
  normalizeImageBlockSource,
  systemToText,
  toOpenAITools,
} from './openaiCompatible.js'
import {
  ProviderCapabilityError,
  ProviderResponseParseError,
  type ProviderMessageClient,
} from './providerClient.js'
import {
  fetchWithProviderReliability,
  getProviderRequestTimeoutMs,
} from './providerHttp.js'
import {
  createOpenAIResponsesSSEMessageStream,
  mergeAbortSignals,
} from './streamingAdapters.js'
import {
  OpenAIResponsesStateStore,
  type OpenAIResponseStateMode,
  type OpenAIResponseStateStatus,
} from './openaiResponsesState.js'

export type OpenAIResponsesToolSearchMode = 'off' | 'hosted'

export type OpenAIResponsesClientOptions = {
  apiKey: string
  baseUrl?: string
  maxRetries?: number
  model?: string
  store?: boolean
  compactThreshold?: number
  toolSearch?: OpenAIResponsesToolSearchMode
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  stateStore?: OpenAIResponsesStateStore
}

export type OpenAIResponsesPollOptions = {
  intervalMs?: number
  maxWaitMs?: number
  signal?: AbortSignal
}

export type OpenAIResponsesRawRequestOptions = {
  signal?: AbortSignal
  timeoutMs?: number
  headers?: HeadersInit
}

type RawResponse = Record<string, any> & {
  id: string
  status: OpenAIResponseStateStatus
  model?: string
  output?: any[]
}

type URHQResponsesClient = ProviderMessageClient & {
  responses: OpenAIResponsesHTTPTransport
}

const TERMINAL_STATUSES = new Set<OpenAIResponseStateStatus>([
  'completed',
  'failed',
  'cancelled',
  'incomplete',
])
const RESPONSE_ID_RE = /^[A-Za-z0-9_-]{1,200}$/u

function responsesEndpoint(baseUrl?: string): string {
  const url = new URL(baseUrl ?? 'https://api.openai.com/v1')
  url.hash = ''
  url.search = ''
  const path = url.pathname.replace(/\/+$/u, '')
  if (/\/responses$/u.test(path)) {
    url.pathname = path
  } else if (/\/v\d+(?:beta)?$/u.test(path)) {
    url.pathname = `${path}/responses`
  } else {
    url.pathname = `${path}/v1/responses`
  }
  return url.toString().replace(/\/$/u, '')
}

function assertResponseId(id: string): void {
  if (!RESPONSE_ID_RE.test(id)) throw new Error('Invalid OpenAI response id')
}

function responseStatus(value: unknown): OpenAIResponseStateStatus {
  switch (value) {
    case 'queued':
    case 'in_progress':
    case 'completed':
    case 'failed':
    case 'cancelled':
    case 'incomplete':
      return value
    default:
      throw new ProviderResponseParseError(`OpenAI Responses returned invalid status: ${String(value)}`)
  }
}

function parseRawResponse(value: unknown): RawResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProviderResponseParseError('OpenAI Responses returned a non-object payload', { value })
  }
  const response = value as Record<string, any>
  if (response.error) {
    const message = typeof response.error?.message === 'string'
      ? response.error.message
      : JSON.stringify(response.error)
    throw new ProviderResponseParseError(`OpenAI Responses returned an error: ${message}`, { response })
  }
  if (!RESPONSE_ID_RE.test(response.id ?? '')) {
    throw new ProviderResponseParseError('OpenAI Responses payload is missing a valid response id', {
      response,
    })
  }
  return { ...response, status: responseStatus(response.status) } as RawResponse
}

function metadataForResponses(metadata: unknown): Record<string, string> | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined
  const entries = Object.entries(metadata as Record<string, unknown>)
    .filter(([key, value]) => key.length > 0 && key.length <= 64 && value !== undefined)
    .slice(0, 16)
    .map(([key, value]) => [key, String(value).slice(0, 512)])
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function structuredTextConfig(outputConfig: any): Record<string, unknown> | undefined {
  const format = outputConfig?.format
  const effort = outputConfig?.effort
  const verbosity = effort === 'low' || effort === 'medium' || effort === 'high'
    ? effort
    : undefined
  if (format?.type === 'json_schema' && format.schema) {
    return {
      format: {
        type: 'json_schema',
        name: typeof format.name === 'string' && format.name ? format.name : 'ur_response',
        schema: format.schema,
        strict: format.strict !== false,
      },
      ...(verbosity ? { verbosity } : {}),
    }
  }
  return verbosity ? { verbosity } : undefined
}

function reasoningConfig(params: any): Record<string, unknown> | undefined {
  const requested = params.output_config?.effort
  if (requested === 'low' || requested === 'medium' || requested === 'high') {
    return { effort: requested }
  }
  if (requested === 'max') return { effort: 'high' }
  if (params.thinking?.type === 'adaptive') return { effort: 'medium' }
  if (params.thinking?.type !== 'enabled') return undefined
  const budget = Number(params.thinking?.budget_tokens ?? 0)
  if (budget > 0 && budget <= 4_000) return { effort: 'low' }
  if (budget >= 16_000) return { effort: 'high' }
  return { effort: 'medium' }
}

function imageInput(block: any, context: string): Record<string, unknown> {
  const source = normalizeImageBlockSource(block, 'OpenAI Responses', context)
  return {
    type: 'input_image',
    detail: block.detail === 'low' || block.detail === 'high' || block.detail === 'original'
      ? block.detail
      : 'auto',
    image_url: source.type === 'base64'
      ? `data:${source.mediaType};base64,${source.data}`
      : source.url,
  }
}

function documentInput(block: any, context: string): Record<string, unknown> {
  const source = block?.source
  if (source?.type === 'base64' && typeof source.data === 'string') {
    return {
      type: 'input_file',
      file_data: `data:${source.media_type ?? 'application/octet-stream'};base64,${source.data}`,
      ...(typeof block.title === 'string' ? { filename: block.title } : {}),
    }
  }
  if (source?.type === 'url' && typeof source.url === 'string') {
    return { type: 'input_file', file_url: source.url }
  }
  if (source?.type === 'file_id' && typeof source.file_id === 'string') {
    return { type: 'input_file', file_id: source.file_id }
  }
  throw new ProviderCapabilityError(`OpenAI Responses cannot translate document content in ${context}`, {
    capability: 'document_input',
    block,
  })
}

function inputParts(content: any, context: string): any[] {
  if (typeof content === 'string') return [{ type: 'input_text', text: content }]
  if (!Array.isArray(content)) return [{ type: 'input_text', text: '' }]
  const parts: any[] = []
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push({ type: 'input_text', text: block })
    } else if (block?.type === 'text') {
      parts.push({ type: 'input_text', text: String(block.text ?? '') })
    } else if (block?.type === 'image') {
      parts.push(imageInput(block, context))
    } else if (block?.type === 'document') {
      parts.push(documentInput(block, context))
    }
  }
  return parts.length > 0 ? parts : [{ type: 'input_text', text: '' }]
}

function toolResultOutput(block: any, context: string): string | any[] {
  if (!Array.isArray(block?.content)) return contentToText(block?.content)
  const hasRichContent = block.content.some((item: any) =>
    item?.type === 'image' || item?.type === 'document')
  if (!hasRichContent) return contentToText(block.content)
  return inputParts(block.content, context)
}

export function toOpenAIResponsesInput(messages: any): any[] {
  const input: any[] = []
  for (const [messageIndex, message] of (messages ?? []).entries()) {
    const role = message?.role === 'assistant' ? 'assistant' : 'user'
    const content = message?.content
    if (typeof content === 'string') {
      input.push({ type: 'message', role, content })
      continue
    }
    if (!Array.isArray(content)) {
      input.push({ type: 'message', role, content: '' })
      continue
    }
    let pending: any[] = []
    const flush = () => {
      if (pending.length === 0) return
      if (role === 'assistant') {
        const text = pending
          .filter(part => part.type === 'input_text')
          .map(part => part.text)
          .join('\n')
        if (text) input.push({ type: 'message', role: 'assistant', content: text })
      } else {
        input.push({ type: 'message', role: 'user', content: pending })
      }
      pending = []
    }
    for (const [blockIndex, block] of content.entries()) {
      const context = `messages[${messageIndex}].content[${blockIndex}]`
      if (block?.type === 'tool_use') {
        flush()
        if (typeof block.id !== 'string' || typeof block.name !== 'string') {
          throw new ProviderCapabilityError(`Invalid tool_use block in ${context}`, { block })
        }
        input.push({
          type: 'function_call',
          call_id: block.id,
          name: block.name,
          arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input ?? {}),
          status: 'completed',
        })
      } else if (block?.type === 'tool_result') {
        flush()
        if (typeof block.tool_use_id !== 'string') {
          throw new ProviderCapabilityError(`Invalid tool_result block in ${context}`, { block })
        }
        input.push({
          type: 'function_call_output',
          call_id: block.tool_use_id,
          output: toolResultOutput(block, context),
          status: 'completed',
        })
      } else if (block?.type === 'text') {
        pending.push({ type: 'input_text', text: String(block.text ?? '') })
      } else if (block?.type === 'image') {
        if (role === 'assistant') {
          throw new ProviderCapabilityError('OpenAI Responses does not accept assistant image history', {
            block,
          })
        }
        pending.push(imageInput(block, context))
      } else if (block?.type === 'document') {
        if (role === 'assistant') {
          throw new ProviderCapabilityError('OpenAI Responses does not accept assistant document history', {
            block,
          })
        }
        pending.push(documentInput(block, context))
      }
    }
    flush()
  }
  return input
}

function directResponsesTools(tools: any): any[] {
  return toOpenAITools(tools).map(tool => ({
    type: 'function',
    name: tool.function.name,
    ...(tool.function.description !== undefined ? { description: tool.function.description } : {}),
    parameters: tool.function.parameters ?? {},
    strict: tool.function.strict === true,
  }))
}

function safeNamespaceName(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/gu, '_').replace(/^_+|_+$/gu, '')
  return (normalized || 'ur').slice(0, 64)
}

export function buildDeferredToolSearchTools(
  tools: any,
  options: { execution?: 'server' | 'client'; namespace?: string } = {},
): any[] {
  const direct = directResponsesTools(tools)
  if (direct.length === 0) return []
  const baseName = safeNamespaceName(options.namespace ?? 'ur')
  const namespaces: any[] = []
  for (let index = 0; index < direct.length; index += 10) {
    const chunk = direct.slice(index, index + 10)
    const suffix = index === 0 ? '' : `_${Math.floor(index / 10) + 1}`
    namespaces.push({
      type: 'namespace',
      name: `${baseName.slice(0, Math.max(1, 64 - suffix.length))}${suffix}`,
      description: `Deferred UR tools ${Math.floor(index / 10) + 1}`,
      tools: chunk.map(tool => ({ ...tool, defer_loading: true })),
    })
  }
  return [
    ...namespaces,
    {
      type: 'tool_search',
      ...(options.execution === 'client'
        ? {
            execution: 'client',
            description: 'Search the available UR tools by name and description.',
            parameters: {
              type: 'object',
              properties: { query: { type: 'string' } },
              required: ['query'],
              additionalProperties: false,
            },
          }
        : {}),
    },
  ]
}

function searchText(argumentsValue: unknown): string {
  if (typeof argumentsValue === 'string') {
    try {
      return searchText(JSON.parse(argumentsValue))
    } catch {
      return argumentsValue.toLowerCase()
    }
  }
  if (argumentsValue && typeof argumentsValue === 'object') {
    const query = (argumentsValue as Record<string, unknown>).query
    if (typeof query === 'string') return query.toLowerCase()
  }
  return ''
}

export function createClientToolSearchOutput(
  call: { call_id?: string | null; arguments?: unknown },
  tools: any,
  limit = 10,
): Record<string, unknown> {
  if (!call.call_id) throw new Error('Client tool search call is missing call_id')
  const query = searchText(call.arguments)
  const terms = query.split(/\s+/u).filter(Boolean)
  const ranked = directResponsesTools(tools)
    .map((tool, index) => {
      const haystack = `${tool.name} ${tool.description ?? ''}`.toLowerCase()
      const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0)
      return { tool, score, index }
    })
    .filter(item => terms.length === 0 || item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.max(1, Math.min(limit, 10)))
    .map(item => item.tool)
  return {
    type: 'tool_search_output',
    call_id: call.call_id,
    execution: 'client',
    status: 'completed',
    tools: ranked,
  }
}

function responseToolChoice(value: any): any {
  const mapped = mapOpenAIToolChoice(value)
  if (mapped?.type === 'function' && mapped.function?.name) {
    return { type: 'function', name: mapped.function.name }
  }
  return mapped
}

export function toOpenAIResponsesRequest(
  params: any,
  options: {
    store?: boolean
    compactThreshold?: number
    toolSearch?: OpenAIResponsesToolSearchMode
  } = {},
): Record<string, unknown> {
  const tools = options.toolSearch === 'hosted'
    ? buildDeferredToolSearchTools(params.tools)
    : directResponsesTools(params.tools)
  const threshold = options.compactThreshold
  if (threshold !== undefined && (!Number.isSafeInteger(threshold) || threshold < 1_000)) {
    throw new Error('Responses compact threshold must be an integer of at least 1000 tokens')
  }
  const instructions = systemToText(params.system, 'OpenAI Responses')
  const metadata = metadataForResponses(params.metadata)
  const text = structuredTextConfig(params.output_config)
  const reasoning = reasoningConfig(params)
  return {
    model: params.model,
    input: toOpenAIResponsesInput(params.messages),
    ...(instructions ? { instructions } : {}),
    ...(params.max_tokens !== undefined ? { max_output_tokens: params.max_tokens } : {}),
    ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    ...(params.top_p !== undefined ? { top_p: params.top_p } : {}),
    ...(metadata ? { metadata } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(text ? { text } : {}),
    ...(tools.length > 0 ? { tools } : {}),
    ...(params.tool_choice !== undefined ? { tool_choice: responseToolChoice(params.tool_choice) } : {}),
    ...(params.previous_response_id ? { previous_response_id: params.previous_response_id } : {}),
    ...(params.parallel_tool_calls !== undefined
      ? { parallel_tool_calls: Boolean(params.parallel_tool_calls) }
      : {}),
    ...(threshold !== undefined
      ? { context_management: [{ type: 'compaction', compact_threshold: threshold }] }
      : {}),
    store: options.store ?? false,
    stream: Boolean(params.stream),
  }
}

function parsedArguments(item: any): Record<string, unknown> {
  if (typeof item.arguments !== 'string') return {}
  try {
    const parsed = JSON.parse(item.arguments)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('arguments must decode to an object')
    }
    return parsed
  } catch (error) {
    throw new ProviderResponseParseError(
      `OpenAI Responses function call "${String(item.name)}" returned invalid JSON arguments`,
      { item, cause: error },
    )
  }
}

export function parseOpenAIResponsesMessage(data: unknown, fallbackModel: string): any {
  const response = parseRawResponse(data)
  if (response.status === 'failed') {
    const message = response.error?.message ?? 'response failed'
    throw new ProviderResponseParseError(`OpenAI Responses failed: ${message}`, { response })
  }
  const content: any[] = []
  for (const item of response.output ?? []) {
    if (item?.type === 'message') {
      for (const part of item.content ?? []) {
        if (part?.type === 'output_text' && typeof part.text === 'string') {
          content.push({ type: 'text', text: part.text })
        } else if (part?.type === 'refusal' && typeof part.refusal === 'string') {
          content.push({ type: 'text', text: part.refusal })
        }
      }
    } else if (item?.type === 'function_call') {
      if (!item.call_id || !item.name) {
        throw new ProviderResponseParseError('OpenAI Responses returned an invalid function call', {
          item,
        })
      }
      content.push({
        type: 'tool_use',
        id: item.call_id,
        name: item.name,
        input: parsedArguments(item),
        ...(item.namespace ? { namespace: item.namespace } : {}),
      })
    }
  }
  const includesToolUse = content.some(block => block.type === 'tool_use')
  const incompleteReason = response.incomplete_details?.reason
  return {
    id: response.id,
    type: 'message',
    role: 'assistant',
    model: response.model ?? fallbackModel,
    content,
    stop_reason: includesToolUse
      ? 'tool_use'
      : incompleteReason === 'max_output_tokens'
        ? 'max_tokens'
        : 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: response.usage?.input_tokens ?? 0,
      output_tokens: response.usage?.output_tokens ?? 0,
      cache_creation_input_tokens: response.usage?.input_tokens_details?.cache_write_tokens ?? 0,
      cache_read_input_tokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
    },
    openai_response_status: response.status,
    openai_response_output: structuredClone(response.output ?? []),
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    const abort = () => {
      clearTimeout(timer)
      reject(signal?.reason ?? new Error('OpenAI Responses polling aborted'))
    }
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
}

export class OpenAIResponsesHTTPTransport {
  readonly endpoint: string
  readonly #apiKey: string
  readonly #maxRetries: number
  readonly #fetch?: OpenAIResponsesClientOptions['fetch']
  readonly #stateStore?: OpenAIResponsesStateStore
  readonly #defaultModel?: string
  readonly #store: boolean
  readonly #compactThreshold?: number
  readonly #toolSearch: OpenAIResponsesToolSearchMode

  constructor(options: OpenAIResponsesClientOptions) {
    if (!options.apiKey) throw new Error('OpenAI Responses requires an API key')
    this.endpoint = responsesEndpoint(options.baseUrl)
    this.#apiKey = options.apiKey
    this.#maxRetries = options.maxRetries ?? 3
    this.#fetch = options.fetch
    this.#stateStore = options.stateStore
    this.#defaultModel = options.model
    this.#store = options.store ?? false
    this.#compactThreshold = options.compactThreshold
    this.#toolSearch = options.toolSearch ?? 'off'
  }

  toRequest(params: any): Record<string, unknown> {
    return toOpenAIResponsesRequest(params, {
      store: this.#store,
      compactThreshold: this.#compactThreshold,
      toolSearch: this.#toolSearch,
    })
  }

  async create(
    body: Record<string, unknown>,
    options: OpenAIResponsesRawRequestOptions = {},
  ): Promise<RawResponse> {
    const response = await this.#request(this.endpoint, 'POST', body, options)
    const parsed = parseRawResponse(await response.json())
    this.#record(parsed, body.background ? 'background' : 'http')
    return parsed
  }

  async createBackground(
    params: any,
    options: OpenAIResponsesRawRequestOptions = {},
  ): Promise<RawResponse> {
    const body = { ...this.toRequest(params), stream: false, background: true }
    return this.create(body, options)
  }

  async retrieve(
    id: string,
    options: OpenAIResponsesRawRequestOptions = {},
  ): Promise<RawResponse> {
    assertResponseId(id)
    const response = await this.#request(`${this.endpoint}/${encodeURIComponent(id)}`, 'GET', undefined, options)
    const parsed = parseRawResponse(await response.json())
    this.#record(parsed, this.#stateStore?.get(id)?.mode ?? 'background')
    return parsed
  }

  async cancel(
    id: string,
    options: OpenAIResponsesRawRequestOptions = {},
  ): Promise<RawResponse> {
    assertResponseId(id)
    const response = await this.#request(
      `${this.endpoint}/${encodeURIComponent(id)}/cancel`,
      'POST',
      {},
      options,
    )
    const parsed = parseRawResponse(await response.json())
    this.#record(parsed, this.#stateStore?.get(id)?.mode ?? 'background')
    return parsed
  }

  async poll(id: string, options: OpenAIResponsesPollOptions = {}): Promise<RawResponse> {
    const intervalMs = Math.max(0, Math.min(options.intervalMs ?? 1_000, 60_000))
    const maxWaitMs = Math.max(1, Math.min(options.maxWaitMs ?? 10 * 60_000, 24 * 60 * 60_000))
    const deadline = Date.now() + maxWaitMs
    while (true) {
      const response = await this.retrieve(id, { signal: options.signal })
      if (TERMINAL_STATUSES.has(response.status)) return response
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for OpenAI response ${id} after ${maxWaitMs}ms`)
      }
      await delay(Math.min(intervalMs, Math.max(0, deadline - Date.now())), options.signal)
    }
  }

  async resumeStream(
    id: string,
    options: OpenAIResponsesRawRequestOptions & { startingAfter?: number } = {},
  ): Promise<{ response: Response; data: ReturnType<typeof createOpenAIResponsesSSEMessageStream> }> {
    assertResponseId(id)
    const savedCursor = this.#stateStore?.get(id)?.cursor
    const cursor = options.startingAfter ?? savedCursor
    if (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 0)) {
      throw new Error('startingAfter must be a non-negative integer')
    }
    const url = new URL(`${this.endpoint}/${encodeURIComponent(id)}`)
    url.searchParams.set('stream', 'true')
    if (cursor !== undefined) url.searchParams.set('starting_after', String(cursor))
    const response = await this.#request(url.toString(), 'GET', undefined, options)
    return {
      response,
      data: createOpenAIResponsesSSEMessageStream(response.body, {
        signal: options.signal,
        model: this.#stateStore?.get(id)?.model ?? this.#defaultModel,
        requestId: id,
        providerName: 'openai-responses',
        onEvent: event => {
          if (Number.isSafeInteger(event?.sequence_number)) {
            const previous = this.#stateStore?.get(id)
            if (previous) {
              this.#stateStore?.upsert({
                ...previous,
                cursor: event.sequence_number,
                updatedAt: new Date().toISOString(),
              })
            }
          }
        },
      }),
    }
  }

  async compact(
    body: Record<string, unknown>,
    options: OpenAIResponsesRawRequestOptions & { persistForResponseId?: string } = {},
  ): Promise<Record<string, any>> {
    const { persistForResponseId, ...requestOptions } = options
    const response = await this.#request(`${this.endpoint}/compact`, 'POST', body, requestOptions)
    const result = await response.json() as Record<string, any>
    if (result?.object !== 'response.compaction' || !Array.isArray(result.output)) {
      throw new ProviderResponseParseError('OpenAI Responses compact returned an invalid payload', {
        result,
      })
    }
    if (persistForResponseId) {
      this.#stateStore?.setCompactedWindow(persistForResponseId, result.output)
    }
    // The compaction output is canonical opaque context. Return it exactly; callers
    // must not prune or reinterpret it before passing it back as input.
    return result
  }

  async stream(
    body: Record<string, unknown>,
    options: OpenAIResponsesRawRequestOptions & { controller?: AbortController } = {},
  ): Promise<{ response: Response; data: ReturnType<typeof createOpenAIResponsesSSEMessageStream>; requestId: string }> {
    const controller = options.controller ?? new AbortController()
    const signal = mergeAbortSignals([options.signal, controller.signal])
    const response = await this.#request(
      this.endpoint,
      'POST',
      { ...body, stream: true, background: false },
      { ...options, signal },
    )
    const requestId = response.headers.get('x-request-id') ?? `openai-responses-${randomUUID()}`
    return {
      response,
      requestId,
      data: createOpenAIResponsesSSEMessageStream(response.body, {
        controller,
        signal,
        model: typeof body.model === 'string' ? body.model : this.#defaultModel,
        requestId,
        providerName: 'openai-responses',
        onEvent: event => {
          if (event?.response?.id && event?.response?.status) {
            this.#record(parseRawResponse(event.response), 'http')
          }
        },
      }),
    }
  }

  async #request(
    url: string,
    method: 'GET' | 'POST',
    body: Record<string, unknown> | undefined,
    options: OpenAIResponsesRawRequestOptions,
  ): Promise<Response> {
    const headers = new Headers(options.headers)
    headers.set('Authorization', `Bearer ${this.#apiKey}`)
    headers.set('Accept', body?.stream ? 'text/event-stream' : 'application/json')
    if (body !== undefined) {
      headers.set('Content-Type', 'application/json')
      if (!headers.has('Idempotency-Key')) headers.set('Idempotency-Key', randomUUID())
    }
    return fetchWithProviderReliability(
      url,
      {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      },
      {
        fetch: this.#fetch,
        maxRetries: this.#maxRetries,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
        failureMessage: (response, responseBody) =>
          `OpenAI Responses request failed (${response.status}): ${responseBody || response.statusText}`,
      },
    )
  }

  #record(response: RawResponse, mode: OpenAIResponseStateMode): void {
    if (!this.#stateStore) return
    const existing = this.#stateStore.get(response.id)
    this.#stateStore.upsert({
      id: response.id,
      status: response.status,
      model: response.model ?? existing?.model ?? this.#defaultModel ?? 'unknown',
      mode,
      ...(existing?.cursor !== undefined ? { cursor: existing.cursor } : {}),
      ...(existing?.previousResponseId
        ? { previousResponseId: existing.previousResponseId }
        : {}),
      ...(existing?.createdAt ? { createdAt: existing.createdAt } : {}),
      updatedAt: new Date().toISOString(),
    })
  }
}

export async function createOpenAIResponsesClient(
  options: OpenAIResponsesClientOptions,
): Promise<URHQResponsesClient> {
  const transport = new OpenAIResponsesHTTPTransport(options)
  const messages = {
    create(params: any, requestOptions?: OpenAIResponsesRawRequestOptions) {
      const body = transport.toRequest(params)
      if (params.stream) {
        const controller = new AbortController()
        const pending = transport.stream(body, { ...requestOptions, controller })
        return {
          async withResponse() {
            const { response, data, requestId } = await pending
            return { data, response, request_id: requestId }
          },
          controller,
        }
      }
      return transport.create({ ...body, stream: false }, requestOptions).then(raw => {
        const parsed = parseOpenAIResponsesMessage(raw, params.model ?? options.model ?? 'unknown')
        return {
          ...parsed,
          withResponse: () => ({ data: parsed, request_id: raw.id }),
        }
      })
    },
    async countTokens(params: any) {
      return { input_tokens: estimateProviderInputTokens(params) }
    },
  }
  return {
    beta: { messages },
    responses: transport,
  } as URHQResponsesClient
}

export type OpenAIResponsesWebSocketLike = {
  readyState?: number
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener?: (type: string, listener: (event: any) => void, options?: any) => void
  removeEventListener?: (type: string, listener: (event: any) => void) => void
  on?: (type: string, listener: (event: any) => void) => void
  off?: (type: string, listener: (event: any) => void) => void
}

export type OpenAIResponsesWebSocketFactory = (
  url: string,
  headers: Record<string, string>,
) => OpenAIResponsesWebSocketLike | Promise<OpenAIResponsesWebSocketLike>

export type OpenAIResponsesWebSocketOptions = {
  apiKey: string
  baseUrl?: string
  model?: string
  store?: boolean
  timeoutMs?: number
  factory?: OpenAIResponsesWebSocketFactory
  stateStore?: OpenAIResponsesStateStore
}

function socketURL(baseUrl?: string): string {
  const url = new URL(responsesEndpoint(baseUrl))
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:'
  return url.toString()
}

function addSocketListener(
  socket: OpenAIResponsesWebSocketLike,
  type: string,
  listener: (event: any) => void,
): () => void {
  if (socket.addEventListener) {
    socket.addEventListener(type, listener)
    return () => socket.removeEventListener?.(type, listener)
  }
  if (socket.on) {
    socket.on(type, listener)
    return () => socket.off?.(type, listener)
  }
  throw new Error('WebSocket implementation does not support event listeners')
}

function socketData(event: any): string {
  const value = event?.data ?? event
  if (typeof value === 'string') return value
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString('utf8')
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('utf8')
  }
  return String(value ?? '')
}

async function defaultSocketFactory(
  url: string,
  headers: Record<string, string>,
): Promise<OpenAIResponsesWebSocketLike> {
  const { WebSocket } = await import('ws')
  return new WebSocket(url, { headers }) as unknown as OpenAIResponsesWebSocketLike
}

function waitForSocketOpen(socket: OpenAIResponsesWebSocketLike, timeoutMs: number): Promise<void> {
  if (socket.readyState === 1) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('OpenAI Responses WebSocket open timed out')), timeoutMs)
    const cleanups: Array<() => void> = []
    const finish = (error?: Error) => {
      clearTimeout(timer)
      for (const cleanup of cleanups) cleanup()
      if (error) reject(error)
      else resolve()
    }
    cleanups.push(addSocketListener(socket, 'open', () => finish()))
    cleanups.push(addSocketListener(socket, 'error', event => finish(new Error('OpenAI Responses WebSocket failed to open', { cause: event }))))
    cleanups.push(addSocketListener(socket, 'close', () => finish(new Error('OpenAI Responses WebSocket closed before opening'))))
  })
}

export class OpenAIResponsesWebSocketSession {
  readonly #socket: OpenAIResponsesWebSocketLike
  readonly #model?: string
  readonly #store: boolean
  readonly #timeoutMs: number
  readonly #stateStore?: OpenAIResponsesStateStore
  readonly #openedAt = Date.now()
  #previousResponseId?: string
  #tail: Promise<unknown> = Promise.resolve()
  #closed = false

  constructor(socket: OpenAIResponsesWebSocketLike, options: OpenAIResponsesWebSocketOptions) {
    this.#socket = socket
    this.#model = options.model
    this.#store = options.store ?? false
    this.#timeoutMs = Math.max(1_000, options.timeoutMs ?? getProviderRequestTimeoutMs())
    this.#stateStore = options.stateStore
  }

  get previousResponseId(): string | undefined {
    return this.#previousResponseId
  }

  create(
    body: Record<string, unknown>,
    options: { recoveryInput?: unknown } = {},
  ): Promise<RawResponse> {
    const run = this.#tail.then(() => this.#create(body, options, true))
    this.#tail = run.catch(() => undefined)
    return run
  }

  warmup(body: Record<string, unknown> = {}): Promise<RawResponse> {
    return this.create({ ...body, generate: false })
  }

  close(code = 1000, reason = 'completed'): void {
    this.#closed = true
    this.#socket.close(code, reason.slice(0, 123))
  }

  async #create(
    body: Record<string, unknown>,
    options: { recoveryInput?: unknown },
    allowRecovery: boolean,
  ): Promise<RawResponse> {
    if (this.#closed) throw new Error('OpenAI Responses WebSocket session is closed')
    if (Date.now() - this.#openedAt >= 55 * 60_000) {
      throw new Error('OpenAI Responses WebSocket session is nearing the 60-minute limit; reconnect first')
    }
    const request = {
      ...body,
      type: 'response.create',
      ...(body.model || !this.#model ? {} : { model: this.#model }),
      ...(body.previous_response_id || !this.#previousResponseId
        ? {}
        : { previous_response_id: this.#previousResponseId }),
      store: body.store ?? this.#store,
    } as Record<string, unknown>
    delete request.stream
    delete request.background
    try {
      const response = await this.#exchange(request)
      const previous = this.#previousResponseId
      this.#previousResponseId = response.id
      this.#stateStore?.upsert({
        id: response.id,
        status: response.status,
        model: response.model ?? this.#model ?? 'unknown',
        mode: 'websocket',
        ...(previous ? { previousResponseId: previous } : {}),
      })
      return response
    } catch (error) {
      const code = (error as Error & { code?: string }).code
      if (allowRecovery && code === 'previous_response_not_found' && options.recoveryInput !== undefined) {
        this.#previousResponseId = undefined
        const recovered: Record<string, unknown> = {
          ...body,
          input: options.recoveryInput,
        }
        delete recovered.previous_response_id
        return this.#create(recovered, options, false)
      }
      throw error
    }
  }

  #exchange(request: Record<string, unknown>): Promise<RawResponse> {
    return new Promise((resolve, reject) => {
      const cleanups: Array<() => void> = []
      const timer = setTimeout(
        () => finish(undefined, new Error('OpenAI Responses WebSocket response timed out')),
        this.#timeoutMs,
      )
      let settled = false
      const finish = (response?: RawResponse, error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        for (const cleanup of cleanups) cleanup()
        if (error) reject(error)
        else resolve(response!)
      }
      cleanups.push(addSocketListener(this.#socket, 'message', event => {
        let payload: any
        try {
          payload = JSON.parse(socketData(event))
        } catch (error) {
          finish(undefined, new ProviderResponseParseError('OpenAI Responses WebSocket returned invalid JSON', {
            cause: error,
          }))
          return
        }
        if (payload?.type === 'error') {
          const message = payload.error?.message ?? payload.message ?? 'WebSocket response failed'
          const error = new Error(`OpenAI Responses WebSocket error: ${message}`) as Error & { code?: string }
          error.code = payload.error?.code ?? payload.code
          finish(undefined, error)
          return
        }
        if (
          payload?.type === 'response.completed' ||
          payload?.type === 'response.failed' ||
          payload?.type === 'response.incomplete'
        ) {
          try {
            finish(parseRawResponse(payload.response))
          } catch (error) {
            finish(undefined, error instanceof Error ? error : new Error(String(error)))
          }
        }
      }))
      cleanups.push(addSocketListener(this.#socket, 'error', event =>
        finish(undefined, new Error('OpenAI Responses WebSocket transport error', { cause: event }))))
      cleanups.push(addSocketListener(this.#socket, 'close', () =>
        finish(undefined, new Error('OpenAI Responses WebSocket closed before completion'))))
      try {
        this.#socket.send(JSON.stringify(request))
      } catch (error) {
        finish(undefined, error instanceof Error ? error : new Error(String(error)))
      }
    })
  }
}

export async function createOpenAIResponsesWebSocketSession(
  options: OpenAIResponsesWebSocketOptions,
): Promise<OpenAIResponsesWebSocketSession> {
  if (!options.apiKey) throw new Error('OpenAI Responses WebSocket requires an API key')
  const factory = options.factory ?? defaultSocketFactory
  const socket = await factory(socketURL(options.baseUrl), {
    Authorization: `Bearer ${options.apiKey}`,
  })
  await waitForSocketOpen(socket, Math.min(options.timeoutMs ?? 10_000, 60_000))
  return new OpenAIResponsesWebSocketSession(socket, options)
}
