import {
  type AgentCapabilities,
  AgentCapabilitiesSchema,
  type BaseEvent,
  EventSchemas,
  EventType,
} from '@ag-ui/core'
import { EventEncoder } from '@ag-ui/encoder'
import { createHash } from 'node:crypto'
import { constantTimeStringEqual } from '../services/agents/delegation.js'
import {
  AgUiInputError,
  AgUiRunFailure,
  buildAgUiPrompt,
  parseAgUiRunInput,
  runAgUiPrompt,
  type AgUiPermissionMode,
  type AgUiPromptRunner,
  type AgUiToolUpdate,
} from '../services/agents/agUi.js'
import {
  InvalidRequestBodyEncodingError,
  RequestBodyTooLargeError,
  readRequestTextBounded,
} from '../utils/readRequestTextBounded.js'
import {
  RollingRateLimitError,
  RollingRateLimiter,
  readPositiveInteger,
} from '../utils/rollingRateLimiter.js'

const AG_UI_SDK_VERSION = '0.0.57'

export type AgUiServeOptions = {
  host: string
  port: number
  cwd: string
  token?: string
  allowedOrigins?: string[]
  permissionMode?: AgUiPermissionMode
  runPrompt?: AgUiPromptRunner
}

function isLoopback(host: string): boolean {
  const normalized = host.toLowerCase()
  return (
    normalized === '127.0.0.1' ||
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1'
  )
}

function validateHost(host: string): void {
  if (
    !host ||
    host.length > 253 ||
    host.includes('\0') ||
    /[\s/?#]/u.test(host)
  ) {
    throw new Error('AG-UI host must be a safe hostname or IP address')
  }
}

function normalizeAllowedOrigin(origin: string): string {
  if (!origin || origin.length > 2_048 || origin.includes('\0')) {
    throw new Error('AG-UI allowed origins must be non-empty safe origins')
  }
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    throw new Error(`Invalid AG-UI allowed origin: ${origin}`)
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      `AG-UI allowed origin must be an exact HTTP(S) origin: ${origin}`,
    )
  }
  return parsed.origin
}

export function validateAgUiServeOptions(options: AgUiServeOptions): void {
  validateHost(options.host)
  if (
    !Number.isSafeInteger(options.port) ||
    options.port < 1 ||
    options.port > 65_535
  ) {
    throw new Error('AG-UI port must be an integer between 1 and 65535')
  }
  if (!isLoopback(options.host) && !options.token) {
    throw new Error(
      'Refusing to bind AG-UI off-loopback without a bearer token',
    )
  }
  if (
    options.token !== undefined &&
    (!options.token ||
      options.token.length > 4_096 ||
      /[\u0000-\u001f\u007f]/u.test(options.token))
  ) {
    throw new Error('AG-UI bearer token must be a non-empty safe string')
  }
  if (
    options.permissionMode !== undefined &&
    !['default', 'acceptEdits', 'plan'].includes(options.permissionMode)
  ) {
    throw new Error('AG-UI permission mode must be default, acceptEdits, or plan')
  }
  for (const origin of options.allowedOrigins ?? []) {
    normalizeAllowedOrigin(origin)
  }
}

function bearerValue(request: Request): string | undefined {
  const authorization = request.headers.get('authorization')
  const match = authorization ? /^Bearer\s+(.+)$/iu.exec(authorization) : null
  return match?.[1]?.trim()
}

function authenticate(
  request: Request,
  token: string | undefined,
): { ok: boolean; owner: string } {
  if (!token) return { ok: true, owner: 'local' }
  const supplied = bearerValue(request)
  if (!supplied || !constantTimeStringEqual(supplied, token)) {
    return { ok: false, owner: '' }
  }
  return {
    ok: true,
    owner: `bearer:${createHash('sha256').update(supplied).digest('base64url')}`,
  }
}

function allowedOrigin(
  request: Request,
  allowedOrigins: readonly string[],
): string | undefined | null {
  const origin = request.headers.get('origin')
  if (!origin) return undefined
  return allowedOrigins.includes(origin) ? origin : null
}

function commonHeaders(origin?: string): Record<string, string> {
  return {
    'cache-control': 'no-store',
    'x-ag-ui-sdk-version': AG_UI_SDK_VERSION,
    'x-content-type-options': 'nosniff',
    ...(origin
      ? {
          'access-control-allow-origin': origin,
          vary: 'Origin',
        }
      : {}),
  }
}

function jsonResponse(
  status: number,
  body: unknown,
  origin?: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      ...commonHeaders(origin),
      'content-type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  })
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  origin?: string,
  issues?: Array<{ path: string; message: string }>,
  extraHeaders: Record<string, string> = {},
): Response {
  return jsonResponse(
    status,
    {
      error: {
        code,
        message,
        ...(issues && issues.length > 0 ? { issues } : {}),
      },
    },
    origin,
    extraHeaders,
  )
}

function acceptsEventStream(header: string | null): boolean {
  if (!header || !header.trim()) return true
  return header.split(',').some(part => {
    const [mediaType, ...parameters] = part.split(';')
    const normalized = mediaType?.trim().toLowerCase()
    const qualityParameter = parameters.find(value => /^\s*q\s*=/iu.test(value))
    const quality = qualityParameter
      ? /^\s*q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)\s*$/iu.exec(
          qualityParameter,
        )?.[1]
      : undefined
    const q = qualityParameter ? (quality === undefined ? 0 : Number(quality)) : 1
    return (
      Number.isFinite(q) &&
      q > 0 &&
      (normalized === 'text/event-stream' ||
        normalized === 'text/*' ||
        normalized === '*/*')
    )
  })
}

function inputErrorStatus(error: AgUiInputError): number {
  if (error.code === 'INPUT_TOO_LARGE') return 413
  if (error.code.startsWith('UNSUPPORTED_')) return 422
  return 400
}

export function getAgUiCapabilities(): AgentCapabilities {
  return AgentCapabilitiesSchema.parse({
    identity: {
      name: 'UR-Nexus',
      type: 'ur-nexus',
      description:
        'Provider-flexible, local-first autonomous engineering workflow agent.',
      version: MACRO.VERSION,
      provider: 'UR',
      documentationUrl:
        'https://github.com/Maitham16/UR/blob/master/docs/AG_UI.md',
    },
    transport: {
      streaming: true,
      websocket: false,
      httpBinary: false,
      pushNotifications: false,
      resumable: false,
    },
    tools: {
      supported: true,
      parallelCalls: true,
      clientProvided: false,
    },
    output: {
      structuredOutput: false,
      supportedMimeTypes: ['text/plain'],
    },
    state: {
      snapshots: true,
      deltas: false,
      memory: true,
      persistentState: false,
    },
    multiAgent: {
      supported: true,
      delegation: true,
      handoffs: false,
    },
    reasoning: {
      supported: false,
      streaming: false,
      encrypted: false,
    },
    multimodal: {
      input: {
        image: false,
        audio: false,
        video: false,
        pdf: false,
        file: false,
      },
      output: { image: false, audio: false },
    },
    execution: {
      codeExecution: true,
      maxExecutionTime: readPositiveInteger(
        process.env.UR_AG_UI_PROMPT_TIMEOUT_MS,
        30 * 60 * 1000,
        2 * 60 * 60 * 1000,
      ),
    },
    humanInTheLoop: {
      supported: false,
      approvals: false,
      interventions: false,
      feedback: false,
      interrupts: false,
      approveWithEdits: false,
    },
    custom: {
      protocol: 'AG-UI',
      sdkVersion: AG_UI_SDK_VERSION,
      endpoint: '/ag-ui',
      security: 'loopback-or-bearer',
    },
  })
}

function boundedEventText(value: string): string {
  return value.length <= 256_000
    ? value
    : `${value.slice(0, 255_984)}\n[truncated]`
}

function toolResultContent(
  update: Extract<AgUiToolUpdate, { kind: 'result' }>,
): string {
  if (typeof update.output === 'string') return boundedEventText(update.output)
  if (update.output !== undefined) {
    try {
      return boundedEventText(JSON.stringify(update.output))
    } catch {
      // The runner already bounds serializable values, but keep the protocol
      // stream valid if an injected integration violates that contract.
    }
  }
  return update.failed ? 'Tool failed.' : 'Tool completed.'
}

export function createAgUiHttpHandler(
  options: Pick<
    AgUiServeOptions,
    | 'cwd'
    | 'token'
    | 'allowedOrigins'
    | 'permissionMode'
    | 'runPrompt'
  >,
): (request: Request) => Promise<Response> {
  const limiter = new RollingRateLimiter({
    maxCalls: readPositiveInteger(
      process.env.UR_AG_UI_MAX_CALLS_PER_MINUTE,
      120,
      20_000,
    ),
    windowMs: 60_000,
    maxConcurrent: readPositiveInteger(
      process.env.UR_AG_UI_MAX_CONCURRENT_RUNS,
      8,
      200,
    ),
  })
  const origins = [
    ...new Set((options.allowedOrigins ?? []).map(normalizeAllowedOrigin)),
  ]
  const activeRuns = new Map<string, AbortController>()
  const runner = options.runPrompt ?? runAgUiPrompt
  const permissionMode = options.permissionMode ?? 'default'

  return async request => {
    const url = new URL(request.url)
    if (url.pathname === '/healthz' && request.method === 'GET') {
      return jsonResponse(200, {
        ok: true,
        protocol: 'AG-UI',
        sdkVersion: AG_UI_SDK_VERSION,
      })
    }
    if (url.pathname !== '/ag-ui' && url.pathname !== '/ag-ui/capabilities') {
      return errorResponse(404, 'NOT_FOUND', 'Not found')
    }
    const origin = allowedOrigin(request, origins)
    if (origin === null) {
      return errorResponse(403, 'ORIGIN_NOT_ALLOWED', 'Origin is not allowed')
    }
    if (request.method === 'OPTIONS') {
      return jsonResponse(204, {}, origin, {
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers':
          'Authorization, Content-Type, Accept, Traceparent, Tracestate, Baggage',
        'access-control-max-age': '600',
      })
    }
    const auth = authenticate(request, options.token)
    if (!auth.ok) {
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', origin, undefined, {
        'www-authenticate': 'Bearer',
      })
    }
    if (url.pathname === '/ag-ui/capabilities') {
      if (request.method !== 'GET') {
        return errorResponse(
          405,
          'METHOD_NOT_ALLOWED',
          'GET required',
          origin,
          undefined,
          { allow: 'GET, OPTIONS' },
        )
      }
      return jsonResponse(200, getAgUiCapabilities(), origin)
    }
    if (request.method !== 'POST') {
      return errorResponse(
        405,
        'METHOD_NOT_ALLOWED',
        'POST required',
        origin,
        undefined,
        { allow: 'POST, OPTIONS' },
      )
    }
    if (!acceptsEventStream(request.headers.get('accept'))) {
      return errorResponse(
        406,
        'NOT_ACCEPTABLE',
        'Accept must allow text/event-stream',
        origin,
      )
    }
    const contentType =
      request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ??
      ''
    if (contentType !== 'application/json') {
      return errorResponse(
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        'Content-Type must be application/json',
        origin,
      )
    }

    let release: (() => void) | undefined
    try {
      release = limiter.acquire()
    } catch (error) {
      if (error instanceof RollingRateLimitError) {
        return errorResponse(429, 'RATE_LIMITED', error.message, origin, undefined, {
          'retry-after': '60',
        })
      }
      throw error
    }

    let text: string
    try {
      text = await readRequestTextBounded(
        request,
        readPositiveInteger(
          process.env.UR_AG_UI_MAX_REQUEST_BYTES,
          2_000_000,
          8_000_000,
        ),
      )
    } catch (error) {
      release()
      if (error instanceof RequestBodyTooLargeError) {
        return errorResponse(
          413,
          'REQUEST_TOO_LARGE',
          'Request body is too large',
          origin,
        )
      }
      if (error instanceof InvalidRequestBodyEncodingError) {
        return errorResponse(400, 'INVALID_ENCODING', error.message, origin)
      }
      throw error
    }

    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      release()
      return errorResponse(400, 'INVALID_JSON', 'Request body is not valid JSON', origin)
    }

    let input: ReturnType<typeof parseAgUiRunInput>
    try {
      input = parseAgUiRunInput(payload)
    } catch (error) {
      release()
      if (error instanceof AgUiInputError) {
        return errorResponse(
          inputErrorStatus(error),
          error.code,
          error.message,
          origin,
          error.issues,
        )
      }
      throw error
    }

    const runKey = `${auth.owner}\0${input.threadId}\0${input.runId}`
    if (activeRuns.has(runKey)) {
      release()
      return errorResponse(
        409,
        'RUN_ALREADY_ACTIVE',
        'This threadId/runId is already active',
        origin,
      )
    }

    const abortController = new AbortController()
    const forwardAbort = (): void => abortController.abort(request.signal.reason)
    if (request.signal.aborted) forwardAbort()
    else request.signal.addEventListener('abort', forwardAbort, { once: true })
    activeRuns.set(runKey, abortController)

    const wireEncoder = new EventEncoder({ accept: 'text/event-stream' })
    const textEncoder = new TextEncoder()
    let streamClosed = false
    let heartbeat: ReturnType<typeof setInterval> | undefined

    const cleanup = (): void => {
      if (heartbeat) clearInterval(heartbeat)
      request.signal.removeEventListener('abort', forwardAbort)
      if (activeRuns.get(runKey) === abortController) activeRuns.delete(runKey)
      release?.()
      release = undefined
    }

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enqueueRaw = (value: string): boolean => {
          if (streamClosed) return false
          try {
            controller.enqueue(textEncoder.encode(value))
            return true
          } catch {
            streamClosed = true
            abortController.abort()
            return false
          }
        }
        const emit = (event: BaseEvent): boolean => {
          const validated = EventSchemas.parse(event)
          return enqueueRaw(wireEncoder.encode(validated))
        }
        const finishStream = (): void => {
          if (streamClosed) return
          streamClosed = true
          try {
            controller.close()
          } catch {
            // A disconnected client may already have cancelled the stream.
          }
        }

        heartbeat = setInterval(() => enqueueRaw(': ping\n\n'), 15_000)
        heartbeat.unref?.()

        void (async () => {
          const messageId = `ur-message-${input.runId}`.slice(0, 256)
          const startedTools = new Set<string>()
          const completedTools = new Set<string>()
          let textStarted = false
          let stepStarted = false
          const endText = (): void => {
            if (!textStarted) return
            emit({ type: EventType.TEXT_MESSAGE_END, messageId })
            textStarted = false
          }
          const onTextDelta = (delta: string): void => {
            if (!delta || streamClosed) return
            if (!textStarted) {
              emit({
                type: EventType.TEXT_MESSAGE_START,
                messageId,
                role: 'assistant',
              })
              textStarted = true
            }
            emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta })
          }
          const onToolUpdate = (update: AgUiToolUpdate): void => {
            if (streamClosed) return
            if (update.kind === 'start') {
              if (startedTools.has(update.toolCallId)) return
              startedTools.add(update.toolCallId)
              emit({
                type: EventType.TOOL_CALL_START,
                toolCallId: update.toolCallId,
                toolCallName: update.name,
                ...(textStarted ? { parentMessageId: messageId } : {}),
              })
              emit({
                type: EventType.TOOL_CALL_ARGS,
                toolCallId: update.toolCallId,
                delta: JSON.stringify(update.input ?? {}),
              })
              emit({
                type: EventType.TOOL_CALL_END,
                toolCallId: update.toolCallId,
              })
              return
            }
            if (
              !startedTools.has(update.toolCallId) ||
              completedTools.has(update.toolCallId)
            ) {
              return
            }
            completedTools.add(update.toolCallId)
            emit({
              type: EventType.TOOL_CALL_RESULT,
              messageId: `ur-tool-${update.toolCallId}`.slice(0, 256),
              toolCallId: update.toolCallId,
              content: toolResultContent(update),
              role: 'tool',
            })
          }

          try {
            emit({
              type: EventType.RUN_STARTED,
              threadId: input.threadId,
              runId: input.runId,
              ...(input.parentRunId
                ? { parentRunId: input.parentRunId }
                : {}),
            })
            emit({ type: EventType.STATE_SNAPSHOT, snapshot: input.state })
            emit({ type: EventType.STEP_STARTED, stepName: 'UR-Nexus' })
            stepStarted = true

            const result = await runner(buildAgUiPrompt(input), {
              cwd: options.cwd,
              signal: abortController.signal,
              permissionMode,
              onTextDelta,
              onToolUpdate,
            })
            endText()
            if (stepStarted) {
              emit({ type: EventType.STEP_FINISHED, stepName: 'UR-Nexus' })
              stepStarted = false
            }
            if (result.stopReason === 'cancelled') {
              emit({
                type: EventType.RUN_ERROR,
                message: 'UR agent run was cancelled.',
                code: 'RUN_CANCELLED',
              })
            } else {
              emit({
                type: EventType.RUN_FINISHED,
                threadId: input.threadId,
                runId: input.runId,
                outcome: { type: 'success' },
              })
            }
          } catch (error) {
            endText()
            const failure =
              error instanceof AgUiRunFailure
                ? error
                : new AgUiRunFailure(
                    'AGENT_RUN_FAILED',
                    'UR agent run failed.',
                  )
            emit({
              type: EventType.RUN_ERROR,
              message: failure.message,
              code: failure.code,
            })
          } finally {
            finishStream()
            cleanup()
          }
        })()
      },
      cancel(reason) {
        streamClosed = true
        abortController.abort(reason)
      },
    })

    return new Response(stream, {
      status: 200,
      headers: {
        ...commonHeaders(origin),
        'cache-control': 'no-store, no-transform',
        connection: 'keep-alive',
        'content-type': 'text/event-stream; charset=utf-8',
        'x-accel-buffering': 'no',
      },
    })
  }
}

export async function serveAgUi(options: AgUiServeOptions): Promise<void> {
  validateAgUiServeOptions(options)
  if (typeof Bun === 'undefined' || typeof Bun.serve !== 'function') {
    throw new Error('AG-UI HTTP server requires the Bun runtime')
  }
  let server: ReturnType<typeof Bun.serve> | undefined
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM']
  let shutdown: (() => void) | undefined
  try {
    server = Bun.serve({
      hostname: options.host,
      port: options.port,
      idleTimeout: 255,
      fetch: createAgUiHttpHandler(options),
    })
    // biome-ignore lint/suspicious/noConsole:: CLI server status
    console.log(
      `AG-UI server listening on http://${options.host}:${server.port}/ag-ui`,
    )
    await new Promise<void>(resolve => {
      shutdown = resolve
      for (const signal of signals) process.once(signal, resolve)
    })
  } finally {
    if (shutdown) {
      for (const signal of signals) process.removeListener(signal, shutdown)
    }
    server?.stop(true)
  }
}
