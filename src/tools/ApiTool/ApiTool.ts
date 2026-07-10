import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { isPreapprovedHost } from '../WebFetchTool/preapproved.js'
import { assertPublicUrl } from '../WebFetchTool/utils.js'
import { lazySchema } from '../../utils/lazySchema.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'

const API_TOOL_NAME = 'Api'

const inputSchema = lazySchema(() =>
  z.strictObject({
    url: z.string().url().describe('The URL to call'),
    method: z
      .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
      .default('GET')
      .describe('HTTP method'),
    headers: z.record(z.string(), z.string()).optional().describe('Additional request headers'),
    body: z
      .union([z.string(), z.record(z.string(), z.unknown())])
      .optional()
      .describe('Request body (JSON object or raw string'),
    timeout: z.number().int().min(1).max(300).optional().describe('Request timeout in seconds (max 300)'),
    extract: z.string().optional().describe('Optional dotted path to extract from JSON response'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    status: z.number(),
    statusText: z.string(),
    headers: z.record(z.string(), z.string()),
    body: z.unknown(),
    durationMs: z.number(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

function getBody(input: z.infer<InputSchema>): string | undefined {
  if (input.body === undefined) return undefined
  if (typeof input.body === 'string') return input.body
  return JSON.stringify(input.body)
}

function extractPath(obj: unknown, path: string): unknown {
  const parts = path.split('.').filter(Boolean)
  let current: unknown = obj
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

const SENSITIVE_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i
const SENSITIVE_QUERY_KEY = /(^|[_-])(api[_-]?key|access[_-]?token|auth|authorization|secret|signature|sig)($|[_-])/i
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024

export function containsSensitiveRequestData(input: z.infer<InputSchema>): boolean {
  if (Object.keys(input.headers ?? {}).some(name => SENSITIVE_HEADER.test(name))) return true
  try {
    const url = new URL(input.url)
    return [...url.searchParams.keys()].some(key => SENSITIVE_QUERY_KEY.test(key))
  } catch {
    return true
  }
}

export const ApiTool = buildTool({
  name: API_TOOL_NAME,
  searchHint: 'make REST API calls',
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  async description(input) {
    try {
      const hostname = new URL(input.url).hostname
      return `UR wants to call ${hostname}`
    } catch {
      return 'UR wants to call an API'
    }
  },
  async prompt() {
    return 'Make an HTTP request to a URL and return status, headers, and body. Supports GET, POST, PUT, PATCH, DELETE.'
  },
  userFacingName() {
    return 'API'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly(input) {
    return input.method === 'GET'
  },
  isDestructive(input) {
    return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(input.method)
  },
  toAutoClassifierInput(input) {
    return `${input.method} ${input.url}`
  },
  async checkPermissions(input): Promise<PermissionDecision> {
    try {
      const parsedUrl = new URL(input.url)
      if (
        isPreapprovedHost(parsedUrl.hostname, parsedUrl.pathname) &&
        input.method === 'GET' &&
        !containsSensitiveRequestData(input)
      ) {
        return {
          behavior: 'allow',
          updatedInput: input,
          decisionReason: { type: 'other', reason: 'Preapproved host and read-only method' },
        }
      }
    } catch {
      // fall through
    }
    return {
      behavior: 'ask',
      message: `UR wants to call ${input.method} ${input.url}`,
      updatedInput: input,
    }
  },
  renderToolUseMessage() {
    return null
  },
  async validateInput(input) {
    if (input.method === 'GET' && input.body !== undefined) {
      return { result: false, message: 'GET requests cannot include a request body.', errorCode: 1 }
    }
    try {
      await assertPublicUrl(input.url)
      return { result: true }
    } catch (error) {
      return {
        result: false,
        message: error instanceof Error ? error.message : String(error),
        errorCode: 2,
      }
    }
  },
  async call(input, context = undefined) {
    const start = performance.now()
    await assertPublicUrl(input.url)
    const body = getBody(input)
    const headers: Record<string, string> = {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(input.headers || {}),
    }

    const timeoutSignal = AbortSignal.timeout((input.timeout ?? 30) * 1000)
    const signal = context?.abortController?.signal
      ? AbortSignal.any([context.abortController.signal, timeoutSignal])
      : timeoutSignal
    const response = await fetch(input.url, {
      method: input.method,
      headers,
      body,
      redirect: 'manual',
      signal,
    })

    const contentType = response.headers.get('content-type') || ''
    const declaredLength = Number(response.headers.get('content-length') || '0')
    if (declaredLength > MAX_RESPONSE_BYTES) {
      throw new Error(`API response exceeds the ${MAX_RESPONSE_BYTES}-byte limit`)
    }
    let responseBody: unknown
    const bytes = await response.arrayBuffer()
    if (bytes.byteLength > MAX_RESPONSE_BYTES) {
      throw new Error(`API response exceeds the ${MAX_RESPONSE_BYTES}-byte limit`)
    }
    const text = new TextDecoder().decode(bytes)
    if (contentType.includes('application/json')) {
      try {
        responseBody = JSON.parse(text)
      } catch {
        responseBody = text
      }
    } else {
      responseBody = text
    }

    const headerPairs: [string, string][] = []
    response.headers.forEach((value, key) => {
      headerPairs.push([key, value])
    })

    const result: Output = {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(headerPairs),
      body: input.extract ? extractPath(responseBody, input.extract) : responseBody,
      durationMs: Math.round(performance.now() - start),
    }
    return { data: result }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: JSON.stringify(content),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
