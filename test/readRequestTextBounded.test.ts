import { describe, expect, test } from 'bun:test'
import {
  InvalidRequestBodyEncodingError,
  RequestBodyTooLargeError,
  readRequestTextBounded,
} from '../src/utils/readRequestTextBounded.js'

function streamingRequest(chunks: Uint8Array[]): Request {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
  return new Request('http://127.0.0.1/test', {
    method: 'POST',
    body,
    duplex: 'half',
  } as RequestInit)
}

describe('bounded Fetch request reader', () => {
  test('decodes UTF-8 split across stream chunks', async () => {
    const encoded = new TextEncoder().encode('hello 🙂')
    const request = streamingRequest([
      encoded.slice(0, encoded.length - 2),
      encoded.slice(encoded.length - 2),
    ])
    await expect(readRequestTextBounded(request, 64)).resolves.toBe('hello 🙂')
  })

  test('cancels a chunked body as soon as it exceeds the limit', async () => {
    const request = streamingRequest([
      new Uint8Array(4),
      new Uint8Array(4),
    ])
    await expect(readRequestTextBounded(request, 7)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError,
    )
  })

  test('rejects malformed UTF-8', async () => {
    const request = streamingRequest([new Uint8Array([0xc3, 0x28])])
    await expect(readRequestTextBounded(request, 64)).rejects.toBeInstanceOf(
      InvalidRequestBodyEncodingError,
    )
  })
})
