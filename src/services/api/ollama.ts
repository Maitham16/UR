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
  getOllamaBaseUrl,
  normalizeOllamaBaseUrl,
} from '../../utils/model/ollamaConfig.js'
import {
  computeOllamaNumCtx,
  getOllamaKeepAlive,
  getOllamaNumCtxOverride,
  MIN_CHAT_NUM_CTX,
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
import { parseToolInputJsonLenient } from '../../utils/json.js'
import {
  describeVisionSupport,
  resolveVisionSupport,
  shouldSendImages,
  type VisionSupport,
} from '../../utils/model/visionCapability.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  assertValidProviderToolUses,
  isProviderToolInput,
  ProviderResponseParseError,
} from './providerClient.js'
import {
  assertUniqueToolNames,
  assertValidToolName,
  prepareAndValidateToolSchema,
  ToolSchemaValidationError,
} from './toolSchema.js'
import { DEFAULT_STREAM_IDLE_TIMEOUT_MS } from './streamIdleTimeout.js'

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

export type OllamaToolCall = {
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
  timeoutMs?: number
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

type OllamaFetchResult = {
  response: Response
  textToolFallbackAllowed: boolean
}

const DEFAULT_OLLAMA_REQUEST_TIMEOUT_MS = 300_000
/** Header-wait ceiling: prefill and a cold model load both land inside it. */
const OLLAMA_HEADER_TIMEOUT_MS = 900_000
const REMOTE_OLLAMA_REQUEST_TIMEOUT_MS = 120_000
const CLOUD_OLLAMA_REQUEST_TIMEOUT_MS = 120_000
const OLLAMA_GATEWAY_TIMEOUT_MESSAGE =
  'Ollama gateway timed out while waiting for the model to respond. Check the selected Ollama endpoint or increase API_TIMEOUT_MS if the model needs more time.'
const ollamaModelCapabilitiesCache = new Map<
  string,
  OllamaModelCapabilities | null
>()

export function createOllamaURHQClient(
  options?: { baseUrlOverride?: string }
): unknown {
  // Capture the endpoint per client. A module-global override allowed creating
  // client B to silently retarget in-flight and future requests from client A.
  const baseUrl = getEffectiveOllamaBaseUrl(options?.baseUrlOverride)

  return {
    beta: {
      messages: {
        create(params: BetaMessageStreamParams, options?: RequestOptions) {
          if (params.stream) {
            return createStreamingRequest(params, options, baseUrl)
          }
          return createNonStreamingRequest(params, options, baseUrl)
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

/**
 * Get the current Ollama base URL, respecting any override.
 */
export function getEffectiveOllamaBaseUrl(override?: string): string {
  return override === undefined
    ? getOllamaBaseUrl()
    : normalizeOllamaBaseUrl(override)
}

/**
 * Headers for an Ollama request, including bearer auth when a key is present.
 *
 * A local daemon needs no credential: it holds the account itself, which is how
 * `:cloud` model suffixes work locally. A direct connection to Ollama's hosted
 * API does need one, and without this the request simply 401s — which is why
 * Ollama Cloud was unreachable from CI, where no signed-in daemon exists.
 *
 * The key is read per request rather than cached so a rotated key takes effect
 * without restarting the session.
 */
export function buildOllamaHeaders(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const apiKey = env.OLLAMA_API_KEY?.trim()
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }
  return headers
}

function createStreamingRequest(
  params: BetaMessageStreamParams,
  options?: RequestOptions,
  baseUrl = getEffectiveOllamaBaseUrl(),
) {
  const controller = createLinkedAbortController(options)
  const responsePromise = fetchOllamaChat(
    params,
    true,
    controller,
    options,
    baseUrl,
  )

  return {
    async withResponse() {
      const { response, textToolFallbackAllowed } = await responsePromise
      const requestId = `ollama-${randomUUID()}`
      return {
        data: createURHQStream(
          response,
          params,
          controller,
          requestId,
          textToolFallbackAllowed,
          options,
        ),
        request_id: requestId,
        response,
      }
    },
  }
}

async function createNonStreamingRequest(
  params: BetaMessageStreamParams,
  options?: RequestOptions,
  baseUrl = getEffectiveOllamaBaseUrl(),
): Promise<BetaMessage> {
  const controller = createLinkedAbortController(options)
  const { response, textToolFallbackAllowed } = await fetchOllamaChat(
    params,
    false,
    controller,
    options,
    baseUrl,
  )
  const json = (await response.json()) as OllamaChatChunk
  if (json.error) {
    throw new Error(json.error)
  }
  return ollamaResponseToURHQMessage(json, params, textToolFallbackAllowed)
}

async function fetchOllamaChat(
  params: BetaMessageStreamParams,
  stream: boolean,
  controller: AbortController,
  options?: RequestOptions,
  baseUrl = getEffectiveOllamaBaseUrl(),
): Promise<OllamaFetchResult> {
  // This bounds the wait for response *headers* only — it is cleared in the
  // `finally` once they arrive, after which the per-chunk deadline takes over.
  // Prefill for a large prompt happens entirely inside this window, and a
  // model loading from cold adds to it, so the header wait gets its own
  // generous ceiling rather than the inactivity budget: a long plan was
  // aborted before the first byte and reported as a timeout.
  const timeout = getOllamaHeaderTimeoutMs(options, process.env, params.model)
  const timeoutId =
    timeout > 0
      ? setTimeout(() => controller.abort(), timeout)
      : undefined

  try {
    const capabilities = await getOllamaModelCapabilities(
      params.model,
      baseUrl,
      controller.signal,
    )
    const textToolFallbackAllowed =
      (params.tools?.length ?? 0) > 0 &&
      !modelCapabilityEnabled(capabilities, 'tools')
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: buildOllamaHeaders(),
      body: JSON.stringify(
        toOllamaChatRequest(params, stream, capabilities, baseUrl),
      ),
      signal: controller.signal,
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw createOllamaHTTPError(response.status, body, response.statusText)
    }

    return { response, textToolFallbackAllowed }
  } catch (error) {
    if (controller.signal.aborted) {
      if (options?.signal?.aborted) {
        throw new APIUserAbortError()
      }
      throw new APIConnectionTimeoutError({ message: 'Ollama request timed out' })
    }
    if (
      error instanceof APIConnectionError ||
      error instanceof APIConnectionTimeoutError ||
      error instanceof APIUserAbortError
    ) {
      throw error
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

function createOllamaHTTPError(
  status: number,
  body: string,
  statusText: string,
): Error {
  const rawMessage = extractOllamaHTTPErrorMessage(body) || statusText
  if (isOllamaGatewayTimeout(status, rawMessage)) {
    return new APIConnectionTimeoutError({
      message: OLLAMA_GATEWAY_TIMEOUT_MESSAGE,
      cause: new Error(`Ollama request failed (${status}): ${rawMessage}`),
    })
  }
  return new Error(`Ollama request failed (${status}): ${rawMessage}`)
}

function extractOllamaHTTPErrorMessage(body: string): string {
  if (!body.trim()) {
    return ''
  }
  try {
    const parsed = JSON.parse(body) as { error?: unknown }
    if (typeof parsed.error === 'string') {
      return parsed.error
    }
  } catch {
    // fall back to raw body below
  }
  return body
}

function isOllamaGatewayTimeout(status: number, message: string): boolean {
  if (status !== 502 && status !== 504) {
    return false
  }
  return /operation timed out|read:.*timed out|timeout|deadline exceeded/i.test(
    message,
  )
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


/**
 * Ceiling on the wait for Ollama's response headers.
 *
 * Distinct from the inactivity budget that governs the stream once it starts.
 * Prefill for a large prompt and a cold model load both happen before the
 * first byte, and neither is idleness — bounding them with the same figure
 * meant a long plan was aborted before the model had said anything. An
 * explicit override still wins, so a caller that wants a tight bound keeps it.
 */
export function getOllamaHeaderTimeoutMs(
  options?: RequestOptions,
  env: Record<string, string | undefined> = process.env,
  model?: string,
): number {
  if (options?.timeoutMs !== undefined || options?.timeout !== undefined) {
    return getOllamaRequestTimeoutMs(options, env, model)
  }
  const override = parseInt(env.API_TIMEOUT_MS || '', 10)
  if (override > 0) return override
  return Math.max(
    OLLAMA_HEADER_TIMEOUT_MS,
    getOllamaRequestTimeoutMs(options, env, model),
  )
}

export function getOllamaRequestTimeoutMs(
  options?: RequestOptions,
  env: Record<string, string | undefined> = process.env,
  model?: string,
): number {
  if (options?.timeoutMs !== undefined || options?.timeout !== undefined) {
    return options.timeoutMs ?? options.timeout ?? DEFAULT_OLLAMA_REQUEST_TIMEOUT_MS
  }

  const override = parseInt(env.API_TIMEOUT_MS || '', 10)
  if (override > 0) {
    return override
  }

  if (isTruthyEnv(env.UR_CODE_REMOTE)) {
    return REMOTE_OLLAMA_REQUEST_TIMEOUT_MS
  }
  if (isOllamaCloudModel(model)) {
    return CLOUD_OLLAMA_REQUEST_TIMEOUT_MS
  }
  return DEFAULT_OLLAMA_REQUEST_TIMEOUT_MS
}

/**
 * Resolve the maximum silent gap inside an already-open Ollama stream.
 *
 * Cloud models can spend longer than two minutes in prefill or tool planning,
 * especially for large contexts. Keep their liveness boundary aligned with
 * the shared provider watchdog while retaining the shorter remote-session
 * ceiling and the bounded cloud non-streaming fallback.
 */
export function getOllamaStreamIdleTimeoutMs(
  options?: RequestOptions,
  env: Record<string, string | undefined> = process.env,
  model?: string,
): number {
  if (options?.timeoutMs !== undefined || options?.timeout !== undefined) {
    return getOllamaRequestTimeoutMs(options, env, model)
  }

  const streamOverride = parseInt(env.UR_STREAM_IDLE_TIMEOUT_MS || '', 10)
  if (streamOverride > 0) return streamOverride

  const apiOverride = parseInt(env.API_TIMEOUT_MS || '', 10)
  if (apiOverride > 0) return apiOverride

  return isTruthyEnv(env.UR_CODE_REMOTE)
    ? REMOTE_OLLAMA_REQUEST_TIMEOUT_MS
    : DEFAULT_STREAM_IDLE_TIMEOUT_MS
}

export function isOllamaCloudModel(model: string | undefined): boolean {
  return model?.trim().toLowerCase().endsWith(':cloud') ?? false
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false
  }
  return !['0', 'false', 'no', 'off'].includes(value.toLowerCase())
}

/**
 * One-time-per-model warning when tool definitions are silently dropped
 * because the model does not advertise the `tools` capability in /api/show.
 * Without this, the agent degrades to parsing tool calls out of prose with
 * no signal to the user about why quality fell off a cliff.
 */
const warnedToolsUnsupportedModels = new Set<string>()

/**
 * Appended to the system prompt when tools were requested but the model
 * cannot receive native tool definitions. The format below is exactly what
 * parseBareJsonToolCalls / parseKimiToolCalls recover from plain text, so a
 * cooperative model still gets working tool calls instead of dead prose.
 */
const TEXT_TOOL_CALL_HINT = [
  '',
  'IMPORTANT: This runtime could not register native tool-calling for the current model.',
  'To invoke a tool, output ONLY a single-line JSON object naming the tool and its input, e.g.:',
  '{"tool":"Write","input":{"file_path":"/abs/path/file.py","content":"full file content"}}',
  '{"tool":"Edit","input":{"file_path":"/abs/path/file.py","old_string":"before","new_string":"after"}}',
  '{"tool":"Bash","input":{"command":"ls -la"}}',
  'Escape newlines inside JSON strings as \\n. Do not wrap the JSON in prose or code fences.',
].join('\n')

/**
 * A warning raised while building a request that the user must see.
 *
 * The adapter is far below the transcript, so it cannot yield a message
 * itself. Queue it here and let the query loop drain it — the same shape the
 * prune notice uses. Only capability warnings belong here: anything that
 * merely aids debugging should stay in the debug log.
 */
let pendingProviderNotice: string | null = null

/** Returns and clears the queued notice, so it is shown exactly once. */
export function consumePendingProviderNotice(): string | null {
  const notice = pendingProviderNotice
  pendingProviderNotice = null
  return notice
}

export function toOllamaChatRequest(
  params: BetaMessageStreamParams,
  stream: boolean,
  capabilities: OllamaModelCapabilities | null,
  baseUrl = getEffectiveOllamaBaseUrl(),
): OllamaChatRequest {
  const supportsTools = modelCapabilityEnabled(capabilities, 'tools')
  const tools = supportsTools ? toOllamaTools(params.tools) : []
  const toolsRequested = (params.tools?.length ?? 0) > 0
  const toolsDropped = toolsRequested && !supportsTools
  if (toolsDropped && !warnedToolsUnsupportedModels.has(params.model)) {
    warnedToolsUnsupportedModels.add(params.model)
    const message =
      `"${params.model}" does not advertise the 'tools' capability, so native ` +
      `tool definitions are not sent to it. UR will attempt a conservative ` +
      `text-call fallback, but it is less reliable and may not support every ` +
      `tool. Do not trust claims of completed actions without matching tool ` +
      `results. For reliable tool use, pick a tools-capable model with /model ` +
      `(check with: ur model-doctor).`
    logForDebugging(message, { level: 'warn' })
    // The debug log is invisible in a normal session, so this warning reached
    // nobody: the model silently lost its tools and confabulated the results.
    // Queue it for the transcript instead.
    pendingProviderNotice = message
  }
  const systemMessage: OllamaMessage = {
    role: 'system',
    content: systemToText(params.system) + (toolsDropped ? TEXT_TOOL_CALL_HINT : ''),
  }
  const think = getOllamaThink(params, capabilities)
  const request: OllamaChatRequest = {
    model: params.model,
    messages: [
      systemMessage,
      ...messagesToOllama(
        params.messages,
        resolveVisionSupport(params.model, capabilities),
        params.model,
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
  const estimatedPromptTokens = estimateInputTokens(params)
  const maxTokens =
    typeof params.max_tokens === 'number' ? params.max_tokens : undefined
  const isLightweightChat =
    tools.length === 0 &&
    (maxTokens ?? Number.POSITIVE_INFINITY) <= 1_024 &&
    estimatedPromptTokens <= 4_096
  const numCtx = computeOllamaNumCtx({
    modelContextLength: getOllamaContextLengthForModel(params.model, baseUrl),
    estimatedPromptTokens,
    maxTokens,
    override: getOllamaNumCtxOverride(),
    ...(isLightweightChat ? { minCtx: MIN_CHAT_NUM_CTX } : {}),
  })
  if (numCtx !== undefined) {
    options.num_ctx = numCtx
  }
  logForDebugging(
    `Ollama request sizing: ~${estimatedPromptTokens} input tokens, ${maxTokens ?? 'default'} output tokens, ${tools.length} tools, num_ctx=${numCtx ?? 'server-default'}`,
  )
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

type OllamaSystemContentBlock = NonNullable<
  Exclude<BetaMessageStreamParams['system'], string>
>[number]

function systemToText(system: BetaMessageStreamParams['system']): string {
  if (!system) {
    return ''
  }
  if (typeof system === 'string') {
    return system
  }
  return system.map((block: OllamaSystemContentBlock) => block.text).join('\n\n')
}

function messagesToOllama(
  messages: MessageParam[],
  visionSupport: VisionSupport,
  model = '',
): OllamaMessage[] {
  const supportsVision = shouldSendImages(visionSupport)
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
          const split = splitToolResultContent(block.content)
          // Ollama renders `images` reliably on a user message; support on a
          // tool message is template-dependent, so the bytes travel separately.
          const note = describeToolResultImages(
            split.images.length,
            toolName,
            visionSupport,
            model,
          )
          toolMessages.push({
            role: 'tool',
            content: [split.text, note].filter(Boolean).join('\n'),
            tool_name: toolName,
          })
          if (supportsVision) {
            for (const image of split.images) {
              images.push(image)
            }
          }
          break
        }
        case 'image':
          if (supportsVision && block.source.type === 'base64') {
            images.push(block.source.data)
          } else if (!supportsVision) {
            textParts.push(
              describeVisionSupport(visionSupport, model, 1) ??
                '[Image input omitted]',
            )
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
  if (tools === undefined || tools === null) return []
  if (!Array.isArray(tools)) throw new ToolSchemaValidationError('Ollama tools must be an array.')
  const result: OllamaTool[] = []
  for (const tool of tools as BetaToolUnion[]) {
    if (!tool || typeof tool !== 'object' || !('name' in tool) || !('input_schema' in tool)) {
      throw new ToolSchemaValidationError(
        'Ollama tool entry is missing required name/input_schema fields.',
      )
    }
    assertValidToolName(tool.name, 'Ollama')
    result.push({
      type: 'function',
      function: {
        name: tool.name,
        description: 'description' in tool ? tool.description : undefined,
        parameters: prepareAndValidateToolSchema(tool.input_schema, tool.name),
      },
    })
  }
  assertUniqueToolNames(result.map(tool => tool.function.name), 'Ollama')
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

// Delegates to the shared preparation pass: strips meta and vendor keys at
// every depth (not just the root) and inlines local $ref targets that most
// providers cannot resolve. See services/api/toolSchema.ts.
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

// Models whose `think` accepts graded levels rather than a boolean. Sending a
// level to a boolean-only model is a 400, so levels are opt-in by family.
const LEVELED_THINK_MODEL_RE = /gpt-oss/i

function getOllamaThink(
  params: BetaMessageStreamParams,
  capabilities: OllamaModelCapabilities | null,
): OllamaChatRequest['think'] {
  const thinking = (params as { thinking?: { type?: string } }).thinking
  const supportsThinking = modelCapabilityEnabled(capabilities, 'thinking')
  if (capabilities && !supportsThinking) {
    return undefined
  }
  // --effort lands in output_config.effort. Map it onto the wire: a graded
  // level where the family supports one ('max' clamps to the wire's ceiling),
  // otherwise treat any requested effort as "reasoning on".
  const effort = (
    params as { output_config?: { effort?: unknown } }
  ).output_config?.effort
  const model = String((params as { model?: unknown }).model ?? '')
  if (
    (effort === 'low' || effort === 'medium' || effort === 'high' ||
      effort === 'max') &&
    LEVELED_THINK_MODEL_RE.test(model)
  ) {
    return effort === 'max' ? 'high' : effort
  }
  if (thinking && thinking.type !== 'disabled') {
    return true
  }
  if (typeof effort === 'string') {
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
  baseUrl: string,
  signal?: AbortSignal,
): Promise<OllamaModelCapabilities | null> {
  const normalizedModel = model.trim()
  if (!normalizedModel) {
    return null
  }
  const cacheKey = JSON.stringify([baseUrl, normalizedModel])
  if (ollamaModelCapabilitiesCache.has(cacheKey)) {
    return ollamaModelCapabilitiesCache.get(cacheKey) ?? null
  }

  try {
    const response = await fetch(`${baseUrl}/api/show`, {
      method: 'POST',
      headers: buildOllamaHeaders(),
      body: JSON.stringify({ model: normalizedModel }),
      signal,
    })
    if (!response.ok) {
      ollamaModelCapabilitiesCache.set(cacheKey, null)
      return null
    }
    const body = await response.json()
    cacheOllamaModelMetadata(normalizedModel, body, undefined, baseUrl)
    const capabilities = parseOllamaModelCapabilities(body)
    ollamaModelCapabilitiesCache.set(cacheKey, capabilities)
    return capabilities
  } catch (error) {
    if (signal?.aborted) {
      throw error
    }
    ollamaModelCapabilitiesCache.set(cacheKey, null)
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
  textToolFallbackAllowed: boolean,
  options?: RequestOptions,
): Stream<BetaRawMessageStreamEvent> {
  const stream = {
    controller,
    async *[Symbol.asyncIterator](): AsyncGenerator<BetaRawMessageStreamEvent> {
      yield* streamURHQEvents(
        response,
        params,
        controller,
        requestId,
        textToolFallbackAllowed,
        options,
      )
    },
  }
  return stream as unknown as Stream<BetaRawMessageStreamEvent>
}

async function* streamURHQEvents(
  response: Response,
  params: BetaMessageStreamParams,
  controller: AbortController,
  requestId: string,
  textToolFallbackAllowed: boolean,
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
    if (!textToolFallbackAllowed) {
      if (pendingVisibleText) {
        events.push(...textEvents(pendingVisibleText))
        pendingVisibleText = ''
      }
      return events
    }
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
    getOllamaStreamIdleTimeoutMs(options, process.env, params.model),
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
        const markerIdx = textToolFallbackAllowed
          ? text.indexOf('<|tool_call')
          : -1
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

  if (textToolFallbackAllowed) {
    const kimiParsed = parseKimiToolCalls(text)
    textToolCalls.push(...kimiParsed.toolCalls)
    if (toolCalls.length === 0 && textToolCalls.length === 0) {
      const clarify = parseClarifyingQuestions(text, { availableToolNames })
      if (clarify) textToolCalls.push(clarify)
    }
  }

  const normalizedToolUses = normalizeOllamaToolUses(
    toolCalls,
    textToolCalls,
    availableToolNames,
    'Ollama stream',
  )

  for (const call of normalizedToolUses) {
    yield {
      type: 'content_block_start',
      index: blockIndex,
      content_block: {
        type: 'tool_use',
        id: call.id,
        name: call.name,
        input: {},
      },
    } as BetaRawMessageStreamEvent
    const inputJson = JSON.stringify(call.input)
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
    normalizedToolUses.length === 0
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
      stop_reason:
        normalizedToolUses.length > 0
          ? 'tool_use'
          : getStopReason(finalChunk, []),
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
  // Rearmed after every chunk, so this bounds silence rather than total
  // runtime. A local model answering a long prompt can stream well past any
  // fixed budget; cutting it off mid-answer is a timeout the user cannot act
  // on, whereas a gap this long means the model really is gone.
  const nextDeadline = (): number =>
    timeoutMs > 0 ? Date.now() + timeoutMs : Infinity
  let deadline = nextDeadline()
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
      deadline = nextDeadline()
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
  textToolFallbackAllowed: boolean,
): BetaMessage {
  const content: BetaContentBlock[] = []
  const structured = response.message?.tool_calls ?? []
  const thinking = response.message?.thinking ?? ''
  const availableToolNames = getAvailableToolNames(params.tools)
  const rawText = response.message?.content ?? ''
  const parsedText = textToolFallbackAllowed
    ? parseTextToolCalls(rawText, {
        availableToolNames,
        parseBareJsonToolCalls: true,
        preserveUnavailableToolCalls: true,
      })
    : { text: rawText, toolCalls: [] }
  const text = parsedText.text
  const textToolCalls = [...parsedText.toolCalls]
  const clarifyCall =
    textToolFallbackAllowed &&
    structured.length === 0 &&
    textToolCalls.length === 0
      ? parseClarifyingQuestions(text, { availableToolNames })
      : null
  if (clarifyCall) textToolCalls.push(clarifyCall)
  const normalizedToolUses = normalizeOllamaToolUses(
    structured,
    textToolCalls,
    availableToolNames,
    'Ollama response',
  )
  if (thinking) {
    content.push({
      type: 'thinking',
      thinking,
      signature: '',
    } as BetaContentBlock)
  }
  if (text || normalizedToolUses.length === 0) {
    content.push({ type: 'text', text } as BetaContentBlock)
  }
  for (const call of normalizedToolUses) {
    content.push({
      type: 'tool_use',
      id: call.id,
      name: call.name,
      input: call.input,
    } as BetaContentBlock)
  }

  assertValidProviderToolUses(content, 'Ollama response')
  return {
    id: `ollama-${randomUUID()}`,
    type: 'message',
    role: 'assistant',
    model: response.model ?? params.model,
    content,
    stop_reason:
      normalizedToolUses.length > 0 ? 'tool_use' : getStopReason(response, []),
    stop_sequence: null,
    usage: usageFromOllama(response, text + thinking),
  } as BetaMessage
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEmptyToolArgs(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (isPlainObject(value)) return Object.keys(value).length === 0
  return false
}

/** Canonical serialization for duplicate detection: object keys are sorted
 *  recursively so `{a,b}` and `{b,a}` produce the same key. */
function toolArgsKey(value: unknown): string {
  if (typeof value === 'string') {
    const parsed = parseToolInputJsonLenient(value)
    if (isPlainObject(parsed)) {
      return JSON.stringify(sortKeysDeep(parsed))
    }
    return `string:${value}`
  }
  try {
    return JSON.stringify(sortKeysDeep(value ?? {}))
  } catch {
    return String(value)
  }
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (isPlainObject(value)) {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeysDeep(value[key])
    }
    return sorted
  }
  return value
}

type NormalizedOllamaToolUse = {
  id: string
  name: string
  input: Record<string, unknown>
}

function normalizeOllamaToolUses(
  structured: OllamaToolCall[],
  textCalls: ParsedToolCall[],
  availableToolNames: ReadonlySet<string>,
  context: string,
): NormalizedOllamaToolUse[] {
  const normalized: NormalizedOllamaToolUse[] = []
  const seen = new Set<string>()
  let duplicateCount = 0

  const append = (
    rawName: unknown,
    rawInput: unknown,
    source: 'structured' | 'text',
  ): void => {
    const input =
      source === 'structured'
        ? parseToolInput(rawInput)
        : isProviderToolInput(rawInput)
          ? rawInput
          : null
    if (!input) {
      throw new ProviderResponseParseError(
        `${context} text tool call input must be a JSON object`,
        { rawName, rawInput },
      )
    }
    if (typeof rawName !== 'string' || rawName.trim().length === 0) {
      throw new ProviderResponseParseError(
        `${context} tool call is missing a function name`,
        { rawName, rawInput },
      )
    }
    const name = reconcileToolName(rawName, availableToolNames)
    if (!availableToolNames.has(name)) {
      // Keep a well-formed but unavailable name as a normal tool_use. UR's
      // execution layer is the authority for the active profile and returns a
      // guarded, recoverable tool_result without ever executing the call. A
      // provider parse exception here used to abort the parent agent turn.
      logForDebugging(
        `${context} preserved unavailable tool "${name}" for guarded rejection`,
        { level: 'warn' },
      )
    }
    const key = `${name}\u0000${toolArgsKey(input)}`
    if (seen.has(key)) {
      duplicateCount++
      return
    }
    seen.add(key)
    normalized.push({
      id: `toolu_ollama_${randomUUID().replace(/-/g, '')}`,
      name,
      input,
    })
  }

  for (const call of structured) {
    append(
      call.function?.name,
      call.function?.arguments ?? {},
      'structured',
    )
  }
  for (const call of textCalls) {
    append(call.name, call.input, 'text')
  }

  if (duplicateCount > 0) {
    logForDebugging(
      `Ollama: dropped ${duplicateCount} duplicate tool call(s) after canonical normalization`,
    )
  }
  return normalized
}

function parseCompleteStringToolInput(
  value: string,
): Record<string, unknown> | null {
  const parsed = parseToolInputJsonLenient(value)
  return isPlainObject(parsed) ? parsed : null
}

function mergeToolArgumentStrings(previous: string, next: string): string {
  if (next.startsWith(previous)) return next
  if (previous.startsWith(next)) return previous
  return previous + next
}

/**
 * Accumulates streamed tool calls across chunks.
 *
 * Ollama streams each completed tool call in its own chunk as a
 * single-element `tool_calls` array — it does NOT re-send a cumulative
 * array. The previous positional merge (`target[i] = incoming[i]`) therefore
 * overwrote call N-1 with call N, collapsing multi-call turns (e.g. several
 * Write calls scaffolding a test suite) into just the last call, and a later
 * chunk carrying empty arguments could clobber good arguments via `??`.
 *
 * Rules:
 * - A named call with complete arguments is appended.
 * - A nameless entry is an argument fragment for the call being built:
 *   string fragments concatenate, object fragments shallow-merge.
 * - A same-name entry with string arguments while the last call is still a
 *   string accumulates (fragment-streaming proxies re-send the name).
 * - An entry identical to one already recorded (same name + serialized args)
 *   is skipped, so cumulative-style resends stay idempotent.
 * - Empty arguments never overwrite non-empty arguments.
 */
// Exported for tests (test/ollamaToolCalls.test.ts).
export function mergeToolCalls(
  target: OllamaToolCall[],
  incoming: OllamaToolCall[],
) {
  for (const current of incoming) {
    const fn = current?.function
    if (!fn) {
      throw new ProviderResponseParseError(
        'Ollama streamed a tool call without a function payload',
        { current },
      )
    }
    const name = fn.name
    const args = fn.arguments
    const last = target[target.length - 1]

    if (!name) {
      if (!last?.function) {
        // Preserve an argument-first fragment until a later chunk supplies the
        // name. Dropping it silently turned a provider tool stop into no call.
        target.push({ function: { arguments: args ?? {} } })
        continue
      }
      const prev = last.function.arguments
      if (typeof prev === 'string' && typeof args === 'string') {
        last.function.arguments = mergeToolArgumentStrings(prev, args)
      } else if (isPlainObject(prev) && isPlainObject(args)) {
        last.function.arguments = { ...prev, ...args }
      } else if (isEmptyToolArgs(prev) && !isEmptyToolArgs(args)) {
        last.function.arguments = args
      }
      continue
    }

    if (last?.function && !last.function.name) {
      last.function.name = name
      const previous = last.function.arguments
      if (typeof previous === 'string' && typeof args === 'string') {
        last.function.arguments = mergeToolArgumentStrings(previous, args)
      } else if (isPlainObject(previous) && isPlainObject(args)) {
        last.function.arguments = { ...previous, ...args }
      } else if (isEmptyToolArgs(previous)) {
        last.function.arguments = args ?? {}
      }
      continue
    }

    const key = toolArgsKey(args)
    const duplicate = target.some(
      t =>
        t.function?.name === name &&
        toolArgsKey(t.function?.arguments) === key,
    )
    if (duplicate) {
      continue
    }

    if (
      last?.function?.name === name &&
      typeof args === 'string' &&
      typeof last.function.arguments === 'string'
    ) {
      const previous = last.function.arguments
      const previousComplete = parseCompleteStringToolInput(previous)
      const currentComplete = parseCompleteStringToolInput(args)
      if (!previousComplete) {
        const merged = mergeToolArgumentStrings(previous, args)
        if (
          !currentComplete ||
          args.startsWith(previous) ||
          parseCompleteStringToolInput(merged)
        ) {
          last.function.arguments = merged
          continue
        }
      }
      // Both payloads are independently complete, or a complete payload begins
      // after an abandoned fragment. Preserve the provider's call boundary;
      // final normalization will reject any abandoned incomplete payload.
    }

    if (
      isEmptyToolArgs(args) &&
      last?.function?.name === name &&
      !isEmptyToolArgs(last.function.arguments)
    ) {
      // Trailing empty resend of the call we already have — ignore.
      continue
    }

    target.push({ function: { name, arguments: args ?? {} } })
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

// A tool result carrying an image (a screenshot, a rendered chart) used to be
// flattened to the literal string "[Image output omitted]", so the model was
// told an image existed and never given it. Pull the bytes out instead.
function splitToolResultContent(content: unknown): {
  text: string
  images: string[]
} {
  if (!Array.isArray(content)) {
    return { text: contentBlockToText(content), images: [] }
  }
  const textParts: string[] = []
  const images: string[] = []
  for (const block of content) {
    if (
      block &&
      typeof block === 'object' &&
      'type' in block &&
      block.type === 'image'
    ) {
      const source = (block as { source?: { type?: string; data?: string } })
        .source
      if (source?.type === 'base64' && typeof source.data === 'string') {
        images.push(source.data)
      } else {
        textParts.push('[Image omitted: unsupported image source]')
      }
      continue
    }
    textParts.push(contentBlockToText([block]))
  }
  return { text: textParts.filter(Boolean).join('\n'), images }
}

// Silence is the worst outcome: the model then invents an explanation for the
// user. Say what happened and what would fix it.
function describeToolResultImages(
  count: number,
  toolName: string,
  visionSupport: VisionSupport,
  model: string,
): string {
  if (count === 0) return ''
  const plural = count === 1 ? 'image' : `${count} images`
  if (visionSupport === 'supported') {
    return `[${plural} from ${toolName} attached to the following message]`
  }
  // "does not advertise capabilities" and "advertises capabilities without
  // vision" call for different advice; conflating them sent the user to
  // change models when nothing was wrong with the one they had.
  const detail = describeVisionSupport(visionSupport, model, count)
  return detail ? `[from ${toolName}] ${detail}` : ''
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
    .map((block: Exclude<MessageParam['content'], string>[number]) => {
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

function parseToolInput(input: unknown): Record<string, unknown> {
  if (typeof input !== 'string') {
    const normalized = input ?? {}
    if (!isProviderToolInput(normalized)) {
      throw new ProviderResponseParseError(
        'Ollama tool call arguments must be a JSON object',
        { input },
      )
    }
    return normalized
  }
  const parsed = parseToolInputJsonLenient(input)
  if (parsed === null && input.trim().length > 0) {
    logForDebugging(
      `Ollama tool call arguments failed to parse even after repair: ${input.slice(0, 200)}`,
      { level: 'warn' },
    )
    throw new ProviderResponseParseError(
      'Ollama tool call arguments are not valid JSON after conservative repair',
      { input },
    )
  }
  const normalized = parsed ?? {}
  if (!isProviderToolInput(normalized)) {
    throw new ProviderResponseParseError(
      'Ollama tool call arguments must decode to a JSON object',
      { input },
    )
  }
  return normalized
}
