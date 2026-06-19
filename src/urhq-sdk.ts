export type ClientOptions = {
  apiKey?: string
  baseURL?: string
  maxRetries?: number
  timeout?: number
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  defaultHeaders?: Record<string, string>
}

function errorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined
  }
  const value = error as { message?: unknown; error?: { message?: unknown } }
  if (typeof value.message === 'string') {
    return value.message
  }
  if (typeof value.error?.message === 'string') {
    return value.error.message
  }
  return undefined
}

function requestIdFrom(headers?: Headers, error?: unknown): string | undefined {
  return (
    headers?.get?.('request-id') ??
    headers?.get?.('x-request-id') ??
    ((error as { request_id?: unknown } | undefined)?.request_id as
      | string
      | undefined)
  )
}

export class APIError<
  TStatus extends number = number,
  THeaders = Headers,
  TError = unknown,
> extends Error {
  readonly status: TStatus
  readonly headers?: THeaders
  readonly error: TError
  readonly request_id?: string
  readonly requestID?: string

  constructor(
    status: TStatus,
    error: TError,
    message?: string,
    headers?: THeaders,
  ) {
    super(message ?? errorMessage(error) ?? `API error ${status}`)
    this.name = 'APIError'
    this.status = status
    this.error = error
    this.headers = headers
    const requestId = requestIdFrom(headers as Headers | undefined, error)
    this.request_id = requestId
    this.requestID = requestId
  }
}

export class BadRequestError<TError = unknown> extends APIError<
  400,
  Headers,
  TError
> {
  constructor(error: TError, message?: string, headers?: Headers) {
    super(400, error, message, headers)
    this.name = 'BadRequestError'
  }
}

export class AuthenticationError<TError = unknown> extends APIError<
  401,
  Headers,
  TError
> {
  constructor(error: TError, message?: string, headers?: Headers) {
    super(401, error, message, headers)
    this.name = 'AuthenticationError'
  }
}

export class PermissionDeniedError<TError = unknown> extends APIError<
  403,
  Headers,
  TError
> {
  constructor(error: TError, message?: string, headers?: Headers) {
    super(403, error, message, headers)
    this.name = 'PermissionDeniedError'
  }
}

export class NotFoundError<TError = unknown> extends APIError<
  404,
  Headers,
  TError
> {
  constructor(error: TError, message?: string, headers?: Headers) {
    super(404, error, message, headers)
    this.name = 'NotFoundError'
  }
}

export class UnprocessableEntityError<TError = unknown> extends APIError<
  422,
  Headers,
  TError
> {
  constructor(error: TError, message?: string, headers?: Headers) {
    super(422, error, message, headers)
    this.name = 'UnprocessableEntityError'
  }
}

export class RateLimitError<TError = unknown> extends APIError<
  429,
  Headers,
  TError
> {
  constructor(error: TError, message?: string, headers?: Headers) {
    super(429, error, message, headers)
    this.name = 'RateLimitError'
  }
}

export class InternalServerError<TError = unknown> extends APIError<
  500,
  Headers,
  TError
> {
  constructor(error: TError, message?: string, headers?: Headers) {
    super(500, error, message, headers)
    this.name = 'InternalServerError'
  }
}

export class APIConnectionError extends Error {
  readonly cause?: unknown

  constructor(
    messageOrOptions:
      | string
      | { message?: string; cause?: unknown } = 'Connection error',
    options?: { cause?: unknown },
  ) {
    const message =
      typeof messageOrOptions === 'string'
        ? messageOrOptions
        : messageOrOptions.message
    super(message ?? 'Connection error')
    this.name = 'APIConnectionError'
    this.cause =
      typeof messageOrOptions === 'string'
        ? options?.cause
        : messageOrOptions.cause
  }
}

export class APIConnectionTimeoutError extends APIConnectionError {
  constructor(
    messageOrOptions:
      | string
      | { message?: string; cause?: unknown } = 'Request timed out',
    options?: { cause?: unknown },
  ) {
    if (typeof messageOrOptions === 'string') {
      super(messageOrOptions, options)
    } else {
      super({
        message: messageOrOptions.message ?? 'Request timed out',
        cause: messageOrOptions.cause,
      })
    }
    this.name = 'APIConnectionTimeoutError'
  }
}

export class APIUserAbortError extends Error {
  constructor(message = 'Request aborted') {
    super(message)
    this.name = 'APIUserAbortError'
  }
}

export type ContentBlockParam = any
export type ToolResultBlockParam = any
export type TextBlockParam = any
export type ThinkingBlock = any
export type ThinkingBlockParam = any
export type ImageBlockParam = any
export type ContentBlock = any
export type ToolUseBlock = any
export type ToolUseBlockParam = any
export type MessageParam = any
export type Base64ImageSource = any
export type Tool = any
export type ToolChoice = any
export type BetaTool = any
export type BetaToolUnion = any
export type BetaContentBlock = any
export type BetaContentBlockParam = any
export type BetaImageBlockParam = any
export type BetaJSONOutputFormat = any
export type BetaMessage = any
export type BetaMessageDeltaUsage = any
export type BetaMessageParam = any
export type BetaMessageStreamParams = any
export type BetaRawMessageStreamEvent = any
export type BetaRedactedThinkingBlock = any
export type BetaStopReason = string
export type BetaTextBlockParam = any
export type BetaThinkingBlock = any
export type BetaThinkingConfigParam = any
export type BetaToolChoiceAuto = any
export type BetaToolChoiceTool = any
export type BetaToolResultBlockParam = any
export type BetaToolUseBlock = any
export type BetaToolUseBlockParam = any
export type BetaUsage = any
export type RedactedThinkingBlock = any
export type RedactedThinkingBlockParam = any
export type Stream<Item = any> = AsyncIterable<Item> & {
  controller?: AbortController
}

export namespace Tool {
  export type InputSchema = any
}

export namespace URHQ {
  export type ContentBlock = any
  export type ContentBlockParam = any
  export type ImageBlockParam = any
  export type MessageParam = any
  export type TextBlockParam = any
  export type Tool = any
  export type ToolChoice = any

  export namespace Tool {
    export type InputSchema = any
  }

  export namespace Beta {
    export namespace Messages {
      export type BetaContentBlock = any
      export type BetaContentBlockParam = any
      export type BetaImageBlockParam = any
      export type BetaJSONOutputFormat = any
      export type BetaMessage = any
      export type BetaMessageDeltaUsage = any
      export type BetaMessageParam = any
      export type BetaMessageStreamParams = any
      export type BetaRawMessageStreamEvent = any
      export type BetaStopReason = string
      export type BetaThinkingConfigParam = any
      export type BetaTool = any
      export type BetaToolResultBlockParam = any
      export type BetaToolUnion = any
      export type BetaToolUseBlock = any
      export type BetaToolUseBlockParam = any
      export type BetaUsage = any
    }
  }
}

export interface URHQClient {
  beta: {
    messages: {
      create: (...args: any[]) => any
      countTokens: (...args: any[]) => any
    }
  }
  models?: {
    list: (...args: any[]) => any
  }
}

const urhq = {} as any

export default urhq
