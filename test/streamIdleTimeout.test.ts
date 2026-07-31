import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  isStreamIdleTimeoutError,
  resolveStreamIdleTimeoutMs,
  StreamIdleTimeoutError,
  withStreamIdleTimeout,
} from '../src/services/api/streamIdleTimeout.js'

const encoder = new TextEncoder()

function chunkStream(
  chunks: Array<{ text: string; delayMs: number }>,
  options: { neverEnd?: boolean } = {},
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        await new Promise(resolve => setTimeout(resolve, chunk.delayMs))
        controller.enqueue(encoder.encode(chunk.text))
      }
      if (!options.neverEnd) {
        controller.close()
      }
      // When neverEnd, the stream stays open with no further data — the exact
      // shape of a provider that accepted the request and went silent.
    },
  })
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let out = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) out += decoder.decode(value, { stream: true })
  }
  return out
}

describe('timeout resolution', () => {
  test('falls back to the documented default', () => {
    expect(resolveStreamIdleTimeoutMs(undefined, {})).toBe(DEFAULT_STREAM_IDLE_TIMEOUT_MS)
  })

  test('an explicit value wins', () => {
    expect(resolveStreamIdleTimeoutMs(5000, {})).toBe(5000)
  })

  test('the environment override is honoured', () => {
    expect(resolveStreamIdleTimeoutMs(undefined, { UR_STREAM_IDLE_TIMEOUT_MS: '1234' })).toBe(1234)
  })

  test('nonsense values fall through to the default', () => {
    expect(resolveStreamIdleTimeoutMs(0, {})).toBe(DEFAULT_STREAM_IDLE_TIMEOUT_MS)
    expect(resolveStreamIdleTimeoutMs(-5, {})).toBe(DEFAULT_STREAM_IDLE_TIMEOUT_MS)
    expect(resolveStreamIdleTimeoutMs(Number.NaN, {})).toBe(DEFAULT_STREAM_IDLE_TIMEOUT_MS)
    expect(resolveStreamIdleTimeoutMs(undefined, { UR_STREAM_IDLE_TIMEOUT_MS: 'abc' })).toBe(
      DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    )
  })
})

describe('a healthy stream is never interrupted', () => {
  test('chunks arriving inside the window all pass through', async () => {
    const stream = withStreamIdleTimeout(
      chunkStream([
        { text: 'a', delayMs: 10 },
        { text: 'b', delayMs: 10 },
        { text: 'c', delayMs: 10 },
      ]),
      200,
    )
    expect(await drain(stream)).toBe('abc')
  })

  test('a long stream is not cut off while it keeps producing', async () => {
    // Total duration far exceeds the idle window; no single gap does.
    const chunks = Array.from({ length: 12 }, (_, i) => ({ text: String(i), delayMs: 20 }))
    const stream = withStreamIdleTimeout(chunkStream(chunks), 100)
    expect(await drain(stream)).toBe('0123456789'.concat('1011'))
  })

  test('an empty stream that closes promptly is not an error', async () => {
    const stream = withStreamIdleTimeout(chunkStream([]), 200)
    expect(await drain(stream)).toBe('')
  })
})

describe('a stalled stream fails with a specific reason', () => {
  test('silence after headers is reported, not left hanging', async () => {
    const stream = withStreamIdleTimeout(chunkStream([], { neverEnd: true }), 60)
    await expect(drain(stream)).rejects.toThrow(StreamIdleTimeoutError)
  })

  test('the error names the idle window and says no data arrived', async () => {
    const stream = withStreamIdleTimeout(chunkStream([], { neverEnd: true }), 60)
    try {
      await drain(stream)
      throw new Error('should have rejected')
    } catch (error) {
      expect(isStreamIdleTimeoutError(error)).toBe(true)
      expect((error as StreamIdleTimeoutError).idleMs).toBe(60)
      expect((error as StreamIdleTimeoutError).bytesReceived).toBe(0)
      expect((error as Error).message).toContain('sent no data')
    }
  })

  test('a mid-stream stall reports how much had arrived first', async () => {
    const stream = withStreamIdleTimeout(
      chunkStream([{ text: 'hello', delayMs: 10 }], { neverEnd: true }),
      60,
    )
    try {
      await drain(stream)
      throw new Error('should have rejected')
    } catch (error) {
      expect(isStreamIdleTimeoutError(error)).toBe(true)
      expect((error as StreamIdleTimeoutError).bytesReceived).toBe(5)
      expect((error as Error).message).toContain('stopped sending data')
    }
  })

  test('progress delivered before the stall is preserved', async () => {
    // The consumer keeps what it already read; only the pending read fails.
    const stream = withStreamIdleTimeout(
      chunkStream([{ text: 'partial', delayMs: 5 }], { neverEnd: true }),
      60,
    )
    const reader = stream.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toBe('partial')
    await expect(reader.read()).rejects.toThrow(StreamIdleTimeoutError)
  })

  test('the timer resets on every chunk, so only a real gap fires', async () => {
    const started = Date.now()
    const stream = withStreamIdleTimeout(
      chunkStream(
        [
          { text: 'a', delayMs: 40 },
          { text: 'b', delayMs: 40 },
          { text: 'c', delayMs: 40 },
        ],
        { neverEnd: true },
      ),
      80,
    )
    await expect(drain(stream)).rejects.toThrow(StreamIdleTimeoutError)
    // Three 40ms chunks then an 80ms gap: it must not have fired at 80ms total.
    expect(Date.now() - started).toBeGreaterThanOrEqual(180)
  })
})

describe('cleanup', () => {
  test('the source is cancelled when the watchdog fires', async () => {
    let cancelledWith: unknown
    const source = new ReadableStream<Uint8Array>({
      start() {
        // never enqueues, never closes
      },
      cancel(reason) {
        cancelledWith = reason
      },
    })
    const stream = withStreamIdleTimeout(source, 50)
    await expect(drain(stream)).rejects.toThrow(StreamIdleTimeoutError)
    expect(isStreamIdleTimeoutError(cancelledWith)).toBe(true)
  })

  test('the onTimeout hook fires exactly once', async () => {
    let calls = 0
    const stream = withStreamIdleTimeout(
      chunkStream([], { neverEnd: true }),
      50,
      () => {
        calls++
      },
    )
    await expect(drain(stream)).rejects.toThrow(StreamIdleTimeoutError)
    await new Promise(resolve => setTimeout(resolve, 120))
    expect(calls).toBe(1)
  })

  test('cancelling the wrapper cancels the source and disarms the timer', async () => {
    let cancelled = false
    const source = new ReadableStream<Uint8Array>({
      start() {},
      cancel() {
        cancelled = true
      },
    })
    const stream = withStreamIdleTimeout(source, 50)
    const reader = stream.getReader()
    await reader.cancel('caller went away')
    expect(cancelled).toBe(true)
    // A fired timer after cancellation would surface as an unhandled rejection.
    await new Promise(resolve => setTimeout(resolve, 120))
  })

  test('a source error propagates unchanged rather than as a timeout', async () => {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('connection reset'))
      },
    })
    const stream = withStreamIdleTimeout(source, 500)
    await expect(drain(stream)).rejects.toThrow('connection reset')
  })
})

describe('disabled watchdog', () => {
  test('a non-positive window returns the source untouched', () => {
    const source = chunkStream([])
    expect(withStreamIdleTimeout(source, 0)).toBe(source)
    expect(withStreamIdleTimeout(source, -1)).toBe(source)
    expect(withStreamIdleTimeout(source, Number.NaN)).toBe(source)
  })
})
