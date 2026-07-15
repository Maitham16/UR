export class RequestBodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`request body exceeds ${maxBytes} bytes`)
    this.name = 'RequestBodyTooLargeError'
  }
}

export class InvalidRequestBodyEncodingError extends Error {
  constructor() {
    super('request body is not valid UTF-8')
    this.name = 'InvalidRequestBodyEncodingError'
  }
}

/**
 * Read a Fetch Request body without allowing a chunked request to be buffered
 * without limit. `Request.text()` cannot enforce a bound until after the whole
 * body has already been allocated, so network-facing adapters use this helper.
 */
export async function readRequestTextBounded(
  request: Request,
  maxBytes: number,
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('maxBytes must be a positive safe integer')
  }

  const declared = request.headers.get('content-length')
  if (declared && /^\d+$/u.test(declared.trim())) {
    const declaredBytes = Number(declared)
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxBytes) {
      throw new RequestBodyTooLargeError(maxBytes)
    }
  }

  if (!request.body) return ''
  const reader = request.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const text: string[] = []
  let totalBytes = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new RequestBodyTooLargeError(maxBytes)
      }
      try {
        text.push(decoder.decode(value, { stream: true }))
      } catch {
        throw new InvalidRequestBodyEncodingError()
      }
    }
    try {
      text.push(decoder.decode())
    } catch {
      throw new InvalidRequestBodyEncodingError()
    }
    return text.join('')
  } finally {
    reader.releaseLock()
  }
}
