import { createHash } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { constantTimeStringEqual } from '../services/agents/delegation.js'
import { createMCPServer } from './mcp.js'
import { createLinkedTransportPair } from '../services/mcp/InProcessTransport.js'
import {
  MCP_2026_PROTOCOL_VERSION,
  Mcp2026Error,
  Mcp2026Runtime,
  mcp2026HttpStatus,
  type Mcp2026JsonRpcId,
  type Mcp2026JsonRpcResponse,
  type Mcp2026Tool,
  type Mcp2026ToolResult,
} from '../services/mcp/mcp2026.js'
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

export type Mcp2026ServeOptions = {
  host: string
  port: number
  cwd: string
  token?: string
  allowedOrigins?: string[]
  debug?: boolean
  verbose?: boolean
}

type RuntimeBundle = {
  runtime: Mcp2026Runtime
  close: () => Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

function validateHost(host: string): void {
  if (
    !host ||
    host.length > 253 ||
    host.includes('\0') ||
    /[\s/?#]/u.test(host)
  ) {
    throw new Error('MCP HTTP host must be a safe hostname or IP address')
  }
}

function normalizeAllowedOrigin(origin: string): string {
  if (!origin || origin.length > 2_048 || origin.includes('\0')) {
    throw new Error('MCP allowed origins must be non-empty safe origins')
  }
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    throw new Error(`Invalid MCP allowed origin: ${origin}`)
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`MCP allowed origin must be an exact HTTP(S) origin: ${origin}`)
  }
  return parsed.origin
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

function response(
  status: number,
  body: unknown,
  origin?: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json',
      'mcp-protocol-version': MCP_2026_PROTOCOL_VERSION,
      'x-content-type-options': 'nosniff',
      ...(origin
        ? {
            'access-control-allow-origin': origin,
            vary: 'Origin',
          }
        : {}),
      ...extraHeaders,
    },
  })
}

function rpcError(
  id: Mcp2026JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): Mcp2026JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data !== undefined ? { data } : {}),
    },
  }
}

function requestId(payload: unknown): Mcp2026JsonRpcId {
  if (!isRecord(payload)) return null
  return typeof payload.id === 'string' ||
    (typeof payload.id === 'number' && Number.isSafeInteger(payload.id))
    ? payload.id
    : null
}

function allowedOrigin(
  request: Request,
  allowedOrigins: readonly string[],
): string | undefined | null {
  const origin = request.headers.get('origin')
  if (!origin) return undefined
  return allowedOrigins.includes(origin) ? origin : null
}

function validateRequestEnvelope(
  request: Request,
  payload: unknown,
): {
  clientCapabilities: Record<string, unknown>
} {
  if (!isRecord(payload) || payload.jsonrpc !== '2.0') {
    throw rpcError(requestId(payload), -32600, 'Invalid Request')
  }
  const method = typeof payload.method === 'string' ? payload.method : ''
  if (!method || method.length > 256 || method.includes('\0')) {
    throw rpcError(requestId(payload), -32600, 'Invalid Request method')
  }
  const headerMethod = request.headers.get('mcp-method')
  if (!headerMethod || headerMethod !== method) {
    throw rpcError(
      requestId(payload),
      -32001,
      `Header mismatch: Mcp-Method must exactly match '${method}'`,
    )
  }
  if (request.headers.has('mcp-session-id')) {
    throw rpcError(
      requestId(payload),
      -32001,
      `Mcp-Session-Id was removed in MCP ${MCP_2026_PROTOCOL_VERSION}`,
    )
  }
  const params = payload.params
  if (params !== undefined && !isRecord(params)) {
    throw rpcError(requestId(payload), -32602, 'params must be an object')
  }
  const typedParams = (params ?? {}) as Record<string, unknown>
  const nameField =
    method === 'resources/read'
      ? 'uri'
      : method === 'tasks/get' ||
          method === 'tasks/update' ||
          method === 'tasks/cancel'
        ? 'taskId'
      : method === 'tools/call' || method === 'prompts/get'
        ? 'name'
        : undefined
  if (nameField) {
    const expected = typedParams[nameField]
    const headerName = request.headers.get('mcp-name')
    if (
      typeof expected !== 'string' ||
      !headerName ||
      headerName !== expected
    ) {
      throw rpcError(
        requestId(payload),
        -32001,
        `Header mismatch: Mcp-Name must exactly match params.${nameField}`,
      )
    }
  }
  const protocolHeader = request.headers.get('mcp-protocol-version')
  if (!protocolHeader) {
    throw rpcError(
      requestId(payload),
      -32001,
      'MCP-Protocol-Version header is required',
    )
  }
  if (protocolHeader !== MCP_2026_PROTOCOL_VERSION) {
    throw rpcError(
      requestId(payload),
      -32004,
      `Unsupported MCP protocol version '${protocolHeader}'`,
      {
        supported: [MCP_2026_PROTOCOL_VERSION],
        requested: protocolHeader,
      },
    )
  }
  const meta = typedParams._meta
  if (!isRecord(meta)) {
    throw rpcError(requestId(payload), -32602, 'params._meta is required')
  }
  if (meta['io.modelcontextprotocol/protocolVersion'] !== protocolHeader) {
    throw rpcError(
      requestId(payload),
      -32001,
      'Header mismatch: MCP-Protocol-Version must match params._meta protocolVersion',
    )
  }
  const clientInfo = meta['io.modelcontextprotocol/clientInfo']
  if (
    !isRecord(clientInfo) ||
    typeof clientInfo.name !== 'string' ||
    !clientInfo.name ||
    clientInfo.name.length > 256 ||
    typeof clientInfo.version !== 'string' ||
    !clientInfo.version ||
    clientInfo.version.length > 256
  ) {
    throw rpcError(
      requestId(payload),
      -32602,
      'params._meta clientInfo must include safe name and version strings',
    )
  }
  const clientCapabilities = meta['io.modelcontextprotocol/clientCapabilities']
  if (!isRecord(clientCapabilities)) {
    throw rpcError(
      requestId(payload),
      -32602,
      'params._meta clientCapabilities must be an object',
    )
  }
  return { clientCapabilities }
}

function thrownResponse(error: unknown): Mcp2026JsonRpcResponse {
  if (isRecord(error) && error.jsonrpc === '2.0' && isRecord(error.error)) {
    return error as Mcp2026JsonRpcResponse
  }
  return rpcError(
    null,
    -32603,
    error instanceof Error ? error.message : 'Internal error',
  )
}

export async function createUrMcp2026Runtime(options: {
  cwd: string
  debug?: boolean
  verbose?: boolean
}): Promise<RuntimeBundle> {
  const server = createMCPServer(
    options.cwd,
    options.debug === true,
    options.verbose === true,
  )
  const client = new Client(
    { name: 'ur-mcp-2026-adapter', version: MACRO.VERSION },
    { capabilities: {} },
  )
  const [clientTransport, serverTransport] = createLinkedTransportPair()
  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
  } catch (error) {
    await Promise.allSettled([client.close(), server.close()])
    throw error
  }
  const runtime = new Mcp2026Runtime({
    cwd: options.cwd,
    version: MACRO.VERSION,
    backend: {
      listTools: async () => {
        const listed = await client.listTools()
        return {
          tools: listed.tools as unknown as Mcp2026Tool[],
        }
      },
      callTool: async (name, args, signal) => {
        return (await client.callTool(
          { name, arguments: args },
          undefined,
          {
            signal,
            timeout: readPositiveInteger(
              process.env.UR_MCP_TOOL_TIMEOUT_MS,
              120_000,
              30 * 60_000,
            ),
          },
        )) as unknown as Mcp2026ToolResult
      },
    },
  })
  return {
    runtime,
    close: async () => {
      await client.close()
      await server.close()
    },
  }
}

export function createMcp2026HttpHandler(
  runtime: Mcp2026Runtime,
  options: Pick<Mcp2026ServeOptions, 'token' | 'allowedOrigins'>,
): (request: Request) => Promise<Response> {
  const limiter = new RollingRateLimiter({
    maxCalls: readPositiveInteger(
      process.env.UR_MCP_HTTP_MAX_CALLS_PER_MINUTE,
      240,
      20_000,
    ),
    windowMs: 60_000,
    maxConcurrent: readPositiveInteger(
      process.env.UR_MCP_HTTP_MAX_CONCURRENT_CALLS,
      16,
      200,
    ),
  })
  const allowedOrigins = [
    ...new Set((options.allowedOrigins ?? []).map(normalizeAllowedOrigin)),
  ]

  return async request => {
    const url = new URL(request.url)
    if (url.pathname === '/healthz' && request.method === 'GET') {
      return response(200, { ok: true, protocolVersion: MCP_2026_PROTOCOL_VERSION })
    }
    if (url.pathname !== '/mcp') {
      return response(404, rpcError(null, -32601, 'Not found'))
    }
    const origin = allowedOrigin(request, allowedOrigins)
    if (origin === null) {
      return response(403, rpcError(null, -32000, 'Origin is not allowed'))
    }
    if (request.method === 'OPTIONS') {
      return response(204, {}, origin, {
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers':
          'Authorization, Content-Type, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Traceparent, Tracestate, Baggage',
        'access-control-max-age': '600',
      })
    }
    if (request.method !== 'POST') {
      return response(405, rpcError(null, -32600, 'POST required'), origin, {
        allow: 'POST, OPTIONS',
      })
    }
    const auth = authenticate(request, options.token)
    if (!auth.ok) {
      return response(401, rpcError(null, -32000, 'Unauthorized'), origin, {
        'www-authenticate': 'Bearer',
      })
    }
    const contentType =
      request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ??
      ''
    if (contentType !== 'application/json') {
      return response(
        415,
        rpcError(null, -32600, 'Content-Type must be application/json'),
        origin,
      )
    }

    let release: (() => void) | undefined
    try {
      release = limiter.acquire()
    } catch (error) {
      if (error instanceof RollingRateLimitError) {
        return response(
          429,
          rpcError(null, -32000, error.message),
          origin,
          { 'retry-after': '60' },
        )
      }
      throw error
    }

    try {
      let text: string
      try {
        text = await readRequestTextBounded(
          request,
          readPositiveInteger(
            process.env.UR_MCP_HTTP_MAX_REQUEST_BYTES,
            2_000_000,
            8_000_000,
          ),
        )
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return response(
            413,
            rpcError(null, -32600, 'Request body is too large'),
            origin,
          )
        }
        if (error instanceof InvalidRequestBodyEncodingError) {
          return response(
            400,
            rpcError(null, -32700, error.message),
            origin,
          )
        }
        throw error
      }
      let payload: unknown
      try {
        payload = JSON.parse(text)
      } catch {
        return response(400, rpcError(null, -32700, 'Parse error'), origin)
      }
      let clientCapabilities: Record<string, unknown>
      try {
        ;({ clientCapabilities } = validateRequestEnvelope(request, payload))
      } catch (error) {
        const body = thrownResponse(error)
        return response(mcp2026HttpStatus(body), body, origin)
      }
      if (
        isRecord(payload) &&
        payload.method === 'tools/call' &&
        isRecord(payload.params)
      ) {
        const name = payload.params.name
        const args = payload.params.arguments ?? {}
        if (typeof name === 'string' && isRecord(args)) {
          try {
            await runtime.validateToolHeaders(
              name,
              args,
              request.headers,
              clientCapabilities,
            )
          } catch (error) {
            const body =
              error instanceof Mcp2026Error
                ? rpcError(
                    requestId(payload),
                    error.code,
                    error.message,
                    error.data,
                  )
                : thrownResponse(error)
            return response(mcp2026HttpStatus(body), body, origin)
          }
        }
      }
      const result = await runtime.handle(payload, {
        owner: auth.owner,
        clientCapabilities,
        signal: request.signal,
      })
      return response(mcp2026HttpStatus(result), result, origin)
    } finally {
      release?.()
    }
  }
}

export async function serveMcp2026(options: Mcp2026ServeOptions): Promise<void> {
  validateHost(options.host)
  if (!Number.isSafeInteger(options.port) || options.port < 1 || options.port > 65_535) {
    throw new Error('MCP HTTP port must be an integer between 1 and 65535')
  }
  if (!isLoopback(options.host) && !options.token) {
    throw new Error(
      'Refusing to bind MCP HTTP off-loopback without a bearer token',
    )
  }
  if (
    options.token !== undefined &&
    (!options.token || options.token.length > 4_096 || options.token.includes('\0'))
  ) {
    throw new Error('MCP bearer token must be a non-empty safe string')
  }
  if (typeof Bun === 'undefined' || typeof Bun.serve !== 'function') {
    throw new Error('MCP 2026 HTTP server requires the Bun runtime')
  }
  const bundle = await createUrMcp2026Runtime(options)
  let server: ReturnType<typeof Bun.serve> | undefined
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM']
  let shutdown: (() => void) | undefined
  try {
    const handler = createMcp2026HttpHandler(bundle.runtime, options)
    server = Bun.serve({
      hostname: options.host,
      port: options.port,
      idleTimeout: 255,
      fetch: handler,
    })
    // biome-ignore lint/suspicious/noConsole:: CLI server status
    console.log(
      `MCP ${MCP_2026_PROTOCOL_VERSION} server listening on http://${options.host}:${server.port}/mcp`,
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
    await bundle.close()
  }
}
