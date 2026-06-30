import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { isPreapprovedHost } from '../WebFetchTool/preapproved.js'
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
      if (isPreapprovedHost(parsedUrl.hostname, parsedUrl.pathname) && input.method === 'GET') {
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
  async call(input) {
    const start = performance.now()
    const body = getBody(input)
    const headers: Record<string, string> = {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(input.headers || {}),
    }

    const response = await fetch(input.url, {
      method: input.method,
      headers,
      body,
      signal: AbortSignal.timeout((input.timeout ?? 30) * 1000),
    })

    const contentType = response.headers.get('content-type') || ''
    let responseBody: unknown
    const text = await response.text()
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
