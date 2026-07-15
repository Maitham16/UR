import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios'
import { getInitialSettings } from '../../utils/settings/settings.js'

export const DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS = 120_000
const DEFAULT_PROVIDER_MAX_RETRIES = 3
const DEFAULT_RETRY_BASE_DELAY_MS = 250

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529])
const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 404, 422])
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
    const body =
      typeof error.response?.data === 'string'
        ? error.response.data
        : JSON.stringify(error.response?.data ?? '')
    return `${error.message}\n${body}`
  }
  return error instanceof Error ? error.message : String(error)
}

export function isRetryableProviderError(error: unknown): boolean {
  if (error instanceof ProviderTimeoutError) return true

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

export async function fetchWithProviderReliability(
  input: RequestInfo | URL,
  init: RequestInit,
  options: {
    maxRetries?: number
    timeoutMs?: number
    signal?: AbortSignal
    fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    failureMessage: (response: Response, body: string) => string
  },
): Promise<Response> {
  const timeoutMs = getProviderRequestTimeoutMs(options.timeoutMs)
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
          body,
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
  options: { maxRetries?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<AxiosResponse<T>> {
  const timeout = getProviderRequestTimeoutMs(options.timeoutMs)
  return withProviderRetry(
    () =>
      axios.post<T>(url, body, {
        ...config,
        timeout,
        signal: options.signal ?? config.signal,
      }),
    { maxRetries: options.maxRetries, signal: options.signal },
  )
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
  } else if (path.endsWith('/v1')) {
    url.pathname = `${path}${finalSegment}`
  } else {
    url.pathname = `${path || '/v1'}${path ? '/v1' : ''}${finalSegment}`
  }
  return url.toString().replace(/\/$/, '')
}
