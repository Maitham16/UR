import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios'
import { getInitialSettings } from '../../utils/settings/settings.js'
import {
  resolveStreamIdleTimeoutMs,
  withStreamIdleTimeout,
} from './streamIdleTimeout.js'

export const DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS = 120_000

/**
 * Streaming requests get their own, much larger ceiling.
 *
 * The transport timeout only covers the wait for response headers — once the
 * body starts, liveness is enforced by the inactivity watchdog instead. A long
 * or complex prompt can legitimately spend minutes in the provider's queue and
 * prefill before the first byte, and 120s was cutting those requests off while
 * the provider was still working. This bounds that wait without shortening it
 * to something a real request can hit.
 */
export const DEFAULT_PROVIDER_STREAM_TIMEOUT_MS = 900_000
const DEFAULT_PROVIDER_MAX_RETRIES = 3
const DEFAULT_RETRY_BASE_DELAY_MS = 250
const MAX_PROVIDER_ERROR_BODY_BYTES = 1024 * 1024
const PROVIDER_ERROR_BODY_READ_TIMEOUT_MS = 10_000

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529])
const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 404, 422])
/**
 * Machine-readable provider failures that cannot succeed by replaying the same
 * request. Some APIs report account or billing failures with HTTP 429 even
 * though they are not rate limits. Retrying those responses only hides the
 * actionable error behind a long spinner.
 */
const NON_RETRYABLE_PROVIDER_CODES = new Set([
  'account_deactivated',
  'access_terminated',
  'billing_hard_limit_reached',
  'billing_not_active',
  'insufficient_quota',
  'organization_deactivated',
])
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETRESET',
  'ENETUNREACH',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ECONNABORTED',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
])

export class ProviderHTTPError extends Error {
  readonly status?: number
  readonly code?: string
  readonly body?: string
  readonly headers?: Headers

  constructor(
    message: string,
    details: {
      status?: number
      code?: string
      body?: string
      headers?: Headers
      cause?: unknown
    } = {},
  ) {
    super(message)
    this.name = 'ProviderHTTPError'
    this.status = details.status
    this.code = details.code
    this.body = details.body
    this.headers = details.headers
    if (details.cause !== undefined) {
      this.cause = details.cause
    }
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class ProviderTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Provider request timed out after ${timeoutMs}ms`)
    this.name = 'ProviderTimeoutError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

function parsePositiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return Math.floor(parsed)
}

function parseNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return undefined
  return Math.floor(parsed)
}

export function getProviderRequestTimeoutMs(override?: unknown): number {
  return (
    parsePositiveInteger(override) ??
    parsePositiveInteger(process.env.API_TIMEOUT_MS) ??
    parsePositiveInteger(process.env.UR_API_TIMEOUT_MS) ??
    parsePositiveInteger(getInitialSettings().provider?.timeoutMs) ??
    DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS
  )
}

/**
 * Header-wait ceiling for streaming requests. An explicit override always
 * wins; otherwise this never resolves below the non-streaming ceiling, so
 * raising API_TIMEOUT_MS still raises both.
 */
export function getProviderStreamTimeoutMs(override?: unknown): number {
  const explicit =
    parsePositiveInteger(override) ??
    parsePositiveInteger(process.env.UR_STREAM_REQUEST_TIMEOUT_MS) ??
    parsePositiveInteger(getInitialSettings().provider?.streamTimeoutMs)
  if (explicit !== undefined) return explicit
  return Math.max(
    DEFAULT_PROVIDER_STREAM_TIMEOUT_MS,
    getProviderRequestTimeoutMs(),
  )
}

export function normalizeProviderMaxRetries(value: unknown): number {
  const parsed = parseNonNegativeInteger(value)
  if (parsed === undefined) return DEFAULT_PROVIDER_MAX_RETRIES
  return Math.max(0, parsed)
}

function retryBaseDelayMs(): number {
  return parseNonNegativeInteger(process.env.UR_PROVIDER_RETRY_BASE_MS) ?? DEFAULT_RETRY_BASE_DELAY_MS
}

function retryAfterMs(error: unknown): number | undefined {
  const header =
    error instanceof ProviderHTTPError
      ? error.headers?.get('retry-after')
      : axios.isAxiosError(error)
        ? error.response?.headers?.['retry-after']
        : undefined
  const raw = Array.isArray(header) ? header[0] : header
  if (typeof raw !== 'string') return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const dateMs = Date.parse(raw)
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now())
  return undefined
}

function delayForAttempt(attempt: number, error: unknown): number {
  return retryAfterMs(error) ?? retryBaseDelayMs() * 2 ** Math.max(0, attempt - 1)
}

function errorStatus(error: unknown): number | undefined {
  if (error instanceof ProviderHTTPError) return error.status
  if (axios.isAxiosError(error)) return error.response?.status
  return undefined
}

function errorCode(error: unknown): string | undefined {
  if (error instanceof ProviderHTTPError) return error.code
  if (axios.isAxiosError(error)) return error.code
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

function errorText(error: unknown): string {
  if (error instanceof ProviderHTTPError) return `${error.message}\n${error.body ?? ''}`
  if (axios.isAxiosError(error)) {
    let body = ''
    if (typeof error.response?.data === 'string') {
      body = error.response.data
    } else {
      try {
        body = JSON.stringify(error.response?.data ?? '')
      } catch {
        body = ''
      }
    }
    return `${error.message}\n${body}`
  }
  return error instanceof Error ? error.message : String(error)
}

function providerErrorPayload(error: unknown): unknown {
  if (error instanceof ProviderHTTPError) return error.body
  if (axios.isAxiosError(error)) return error.response?.data
  if (error && typeof error === 'object' && 'body' in error) {
    return (error as { body?: unknown }).body
  }
  return undefined
}

function collectProviderErrorCodes(
  value: unknown,
  codes: Set<string>,
  depth = 0,
): void {
  if (depth > 4 || value === null || value === undefined) return
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        collectProviderErrorCodes(JSON.parse(trimmed), codes, depth + 1)
      } catch {
        // Fall through to the exact-code scan for plain or malformed bodies.
      }
    }
    const lower = trimmed.toLowerCase()
    for (const code of NON_RETRYABLE_PROVIDER_CODES) {
      if (new RegExp(`(?:^|[^a-z0-9_])${code}(?:$|[^a-z0-9_])`, 'u').test(lower)) {
        codes.add(code)
      }
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectProviderErrorCodes(item, codes, depth + 1)
    return
  }
  if (typeof value !== 'object') return
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if ((key === 'code' || key === 'type') && typeof nested === 'string') {
      codes.add(nested.trim().toLowerCase())
    }
    if (key === 'error' || key === 'errors' || key === 'detail' || key === 'details') {
      collectProviderErrorCodes(nested, codes, depth + 1)
    }
  }
}

export function hasNonRetryableProviderCode(error: unknown): boolean {
  const codes = new Set<string>()
  collectProviderErrorCodes(providerErrorPayload(error), codes)
  // Streaming/provider adapters sometimes retain only the human-readable
  // error. Scan that text too, but match exact machine-code boundaries.
  collectProviderErrorCodes(errorText(error), codes)
  return [...codes].some(code => NON_RETRYABLE_PROVIDER_CODES.has(code))
}

export function isRetryableProviderError(error: unknown): boolean {
  if (error instanceof ProviderTimeoutError) return true

  if (hasNonRetryableProviderCode(error)) return false

  const status = errorStatus(error)
  if (status !== undefined) {
    if (NON_RETRYABLE_STATUSES.has(status)) return false
    return RETRYABLE_STATUSES.has(status) || status >= 500
  }

  const code = errorCode(error)
  if (code && TRANSIENT_NETWORK_CODES.has(code)) return true

  const text = errorText(error).toLowerCase()
  return (
    text.includes('overloaded_error') ||
    text.includes('temporarily unavailable') ||
    text.includes('try again later') ||
    text.includes('rate_limit_exceeded') ||
    text.includes('server overloaded')
  )
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason ?? new Error('aborted'))
      },
      { once: true },
    )
  })
}

export async function withProviderRetry<T>(
  operation: () => Promise<T>,
  options: { maxRetries?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const maxRetries = normalizeProviderMaxRetries(options.maxRetries)
  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (options.signal?.aborted) throw options.signal.reason ?? new Error('aborted')
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (attempt >= maxRetries || !isRetryableProviderError(error)) {
        throw error
      }
      await sleep(delayForAttempt(attempt + 1, error), options.signal)
    }
  }
  throw lastError
}

function createTimeoutSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(new ProviderTimeoutError(timeoutMs))
    }
  }, timeoutMs)
  const onAbort = () => {
    if (!controller.signal.aborted) {
      controller.abort(signal?.reason ?? new Error('aborted'))
    }
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    },
  }
}

async function waitForResponseBody(
  response: Response,
  signal: AbortSignal,
): Promise<void> {
  const body = response.clone().body
  if (!body) return

  const reader = body.getReader()
  const onAbort = () => {
    void reader.cancel(signal.reason).catch(() => {})
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    while (true) {
      if (signal.aborted) {
        throw signal.reason ?? new Error('aborted')
      }
      const { done } = await reader.read()
      if (done) break
    }
    if (signal.aborted) {
      throw signal.reason ?? new Error('aborted')
    }
  } finally {
    signal.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }
}

export async function fetchWithProviderReliability(
  input: RequestInfo | URL,
  init: RequestInit,
  options: {
    maxRetries?: number
    timeoutMs?: number
    signal?: AbortSignal
    /** Keep the response body open for SSE/streaming consumers. */
    streaming?: boolean
    /** Inactivity timeout applied to a streaming body. */
    idleTimeoutMs?: number
    fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    failureMessage: (response: Response, body: string) => string
    /** Optional redaction/normalization for the body retained on an error. */
    failureBody?: (response: Response, body: string) => string | undefined
  },
): Promise<Response> {
  const timeoutMs = options.streaming
    ? getProviderStreamTimeoutMs(options.timeoutMs)
    : getProviderRequestTimeoutMs(options.timeoutMs)
  const fetchImpl = options.fetch ?? fetch
  return withProviderRetry(async () => {
    const timeout = createTimeoutSignal(options.signal, timeoutMs)
    try {
      const response = await fetchImpl(input, {
        ...init,
        signal: timeout.signal,
      })
      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new ProviderHTTPError(options.failureMessage(response, body), {
          status: response.status,
          body: options.failureBody
            ? options.failureBody(response, body)
            : body,
          headers: response.headers,
        })
      }
      if (!options.streaming) {
        // fetch() resolves as soon as headers arrive. Drain a clone before
        // releasing the timeout so a stalled JSON body cannot hang forever;
        // the original response remains readable by the caller.
        await waitForResponseBody(response, timeout.signal)
        return response
      }
      // A streaming response resolves at the headers, at which point the
      // total-request timeout above is cleared in `finally`. Without a second,
      // inactivity-based timer a provider that goes silent mid-stream would
      // never fail — the UI would show work in progress indefinitely.
      if (response.body) {
        const idleMs = resolveStreamIdleTimeoutMs(options.idleTimeoutMs)
        return new Response(withStreamIdleTimeout(response.body, idleMs), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        })
      }
      return response
    } catch (error) {
      if (timeout.signal.aborted && timeout.signal.reason instanceof ProviderTimeoutError) {
        throw timeout.signal.reason
      }
      throw error
    } finally {
      timeout.cleanup()
    }
  }, options)
}

export async function axiosPostWithProviderReliability<T = unknown>(
  url: string,
  body: unknown,
  config: AxiosRequestConfig,
  options: {
    maxRetries?: number
    timeoutMs?: number
    signal?: AbortSignal
    /** Use the streaming header-wait ceiling instead of the request ceiling. */
    streaming?: boolean
  } = {},
): Promise<AxiosResponse<T>> {
  const timeout = options.streaming
    ? getProviderStreamTimeoutMs(options.timeoutMs)
    : getProviderRequestTimeoutMs(options.timeoutMs)
  return withProviderRetry(
    async () => {
      try {
        return await axios.post<T>(url, body, {
          ...config,
          timeout,
          signal: options.signal ?? config.signal,
        })
      } catch (error) {
        if (axios.isAxiosError(error) && error.response) {
          let responseData: unknown = error.response.data
          if (options.streaming && isAsyncIterable(responseData)) {
            // Axios exposes non-2xx bodies as a Node stream when responseType is
            // "stream". Buffer that small error payload before classifying it;
            // otherwise a permanent 429 (for example billing_not_active) looks
            // indistinguishable from a transient rate limit and gets replayed.
            responseData = await readProviderErrorBody(responseData, options.signal)
          }
          const responseBody = serializeProviderErrorData(responseData)
          const detail = providerErrorMessage(responseBody)
          throw new ProviderHTTPError(
            `Provider request failed (${error.response.status})${detail ? `: ${detail}` : ''}`,
            {
              status: error.response.status,
              body: responseBody,
              headers: axiosResponseHeaders(error.response.headers),
              cause: error,
            },
          )
        }
        throw error
      }
    },
    { maxRetries: options.maxRetries, signal: options.signal },
  )
}

function serializeProviderErrorData(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Uint8Array) return new TextDecoder().decode(value)
  try {
    return JSON.stringify(value ?? '')
  } catch {
    return ''
  }
}

function providerErrorMessage(body: string): string {
  const trimmed = body.trim()
  if (!trimmed) return ''
  try {
    const parsed = JSON.parse(trimmed) as {
      error?: { message?: unknown }
      message?: unknown
      detail?: unknown
    }
    const message = parsed.error?.message ?? parsed.message ?? parsed.detail
    if (typeof message === 'string') {
      return message.replace(/\s+/gu, ' ').trim().slice(0, 1_000)
    }
  } catch {
    // Plain-text provider responses are already useful diagnostics.
  }
  return trimmed.replace(/\s+/gu, ' ').slice(0, 1_000)
}

function axiosResponseHeaders(value: unknown): Headers {
  const headers = new Headers()
  if (!value || typeof value !== 'object') return headers
  const raw = typeof (value as { toJSON?: unknown }).toJSON === 'function'
    ? (value as { toJSON: () => unknown }).toJSON()
    : value
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return headers
  for (const [name, header] of Object.entries(raw as Record<string, unknown>)) {
    if (header === undefined || header === null) continue
    headers.set(name, Array.isArray(header) ? header.join(', ') : String(header))
  }
  return headers
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(
    value &&
    typeof value === 'object' &&
    Symbol.asyncIterator in value &&
    typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function',
  )
}

async function readProviderErrorBody(
  source: AsyncIterable<unknown>,
  signal?: AbortSignal,
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const read = async (): Promise<string> => {
    const chunks: Uint8Array[] = []
    let bytes = 0
    for await (const chunk of source) {
      if (signal?.aborted) throw signal.reason ?? new Error('aborted')
      const encoded = typeof chunk === 'string'
        ? new TextEncoder().encode(chunk)
        : chunk instanceof Uint8Array
          ? chunk
          : new TextEncoder().encode(String(chunk ?? ''))
      const remaining = MAX_PROVIDER_ERROR_BODY_BYTES - bytes
      if (remaining <= 0) break
      const accepted = encoded.byteLength > remaining
        ? encoded.subarray(0, remaining)
        : encoded
      chunks.push(accepted)
      bytes += accepted.byteLength
      if (bytes >= MAX_PROVIDER_ERROR_BODY_BYTES) break
    }
    const merged = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }
    return new TextDecoder().decode(merged)
  }
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error('Timed out reading provider error response body.')),
      PROVIDER_ERROR_BODY_READ_TIMEOUT_MS,
    )
  })
  try {
    return await Promise.race([read(), deadline])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function trimmedUrl(value: string): URL {
  const withScheme = /^https?:\/\//i.test(value.trim()) ? value.trim() : `http://${value.trim()}`
  return new URL(withScheme)
}

export function normalizeOpenAICompatibleBaseUrl(baseUrl: string): string {
  const url = trimmedUrl(baseUrl)
  url.hash = ''
  url.search = ''
  const path = url.pathname.replace(/\/+$/, '')
  if (path.endsWith('/v1/chat/completions')) {
    url.pathname = path
  } else if (path.endsWith('/chat/completions')) {
    url.pathname = path
  } else if (path.endsWith('/v1')) {
    url.pathname = `${path}/chat/completions`
  } else {
    url.pathname = `${path || ''}/v1/chat/completions`
  }
  return url.toString().replace(/\/$/, '')
}

/** Normalize Gemini gateways so discovery and inference use the same API root. */
export function normalizeGeminiBaseUrl(baseUrl?: string): string {
  const url = trimmedUrl(
    baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta',
  )
  url.hash = ''
  url.search = ''
  let path = url.pathname.replace(/\/+$/, '')
  path = path.replace(/\/models(?:\/.*)?$/i, '')
  if (!/\/v\d+(?:beta)?$/i.test(path)) {
    path = `${path}/v1beta`
  }
  url.pathname = path
  return url.toString().replace(/\/$/, '')
}

export function normalizeProviderEndpoint(
  baseUrl: string | undefined,
  defaultBaseUrl: string,
  finalSegment: string,
): string {
  const url = trimmedUrl(baseUrl ?? defaultBaseUrl)
  url.hash = ''
  url.search = ''
  const path = url.pathname.replace(/\/+$/, '')
  if (path.endsWith(finalSegment)) {
    url.pathname = path
  } else if (/\/v\d+(?:beta)?$/i.test(path)) {
    url.pathname = `${path}${finalSegment}`
  } else {
    url.pathname = `${path || '/v1'}${path ? '/v1' : ''}${finalSegment}`
  }
  return url.toString().replace(/\/$/, '')
}
