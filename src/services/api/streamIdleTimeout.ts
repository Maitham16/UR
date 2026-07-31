/**
 * Inactivity timeout for streaming provider responses.
 *
 * fetchWithProviderReliability applies a total-request timeout, but it is
 * cleared once the response resolves — and for a streaming request that is the
 * moment the *headers* arrive, not the moment the body finishes. A provider
 * that accepted the request and then stopped sending bytes therefore had no
 * timeout at all: the stream stayed open, the UI kept showing work in
 * progress, and nothing ever failed or completed.
 *
 * This wraps a response body so that a gap between chunks longer than
 * `idleMs` aborts the stream with a specific, reportable error. It is an
 * inactivity timeout, distinct from the total-run timeout: a long stream that
 * keeps producing tokens is never interrupted, however long it runs.
 */

export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 60_000

export class StreamIdleTimeoutError extends Error {
  readonly isStreamIdleTimeout = true
  constructor(
    readonly idleMs: number,
    readonly bytesReceived: number,
  ) {
    super(
      bytesReceived === 0
        ? `Provider accepted the request but sent no data for ${idleMs}ms.`
        : `Provider stopped sending data for ${idleMs}ms after ${bytesReceived} bytes.`,
    )
    this.name = 'StreamIdleTimeoutError'
  }
}

export function isStreamIdleTimeoutError(error: unknown): error is StreamIdleTimeoutError {
  return Boolean(error) && (error as StreamIdleTimeoutError).isStreamIdleTimeout === true
}

export function resolveStreamIdleTimeoutMs(
  configured?: number | null,
  env: Record<string, string | undefined> = process.env,
): number {
  const candidates = [
    configured,
    Number.parseInt(env.UR_STREAM_IDLE_TIMEOUT_MS ?? '', 10),
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
      return Math.floor(candidate)
    }
  }
  return DEFAULT_STREAM_IDLE_TIMEOUT_MS
}

/**
 * Wrap a byte stream so a silent gap longer than `idleMs` rejects the reader.
 *
 * Progress already delivered downstream is not discarded — the consumer keeps
 * every chunk it read before the gap, and only the read that was waiting fails.
 *
 * @param onTimeout invoked once when the watchdog fires, for cancellation and
 *   cleanup of whatever produced the stream.
 */
export function withStreamIdleTimeout<T extends { byteLength?: number; length?: number }>(
  source: ReadableStream<T>,
  idleMs: number,
  onTimeout?: (error: StreamIdleTimeoutError) => void,
): ReadableStream<T> {
  if (!Number.isFinite(idleMs) || idleMs <= 0) {
    return source
  }

  const reader = source.getReader()
  let timer: ReturnType<typeof setTimeout> | undefined
  let bytesReceived = 0
  let settled = false

  return new ReadableStream<T>({
    start(controller) {
      const clear = (): void => {
        if (timer !== undefined) {
          clearTimeout(timer)
          timer = undefined
        }
      }

      const fail = (): void => {
        if (settled) return
        settled = true
        const error = new StreamIdleTimeoutError(idleMs, bytesReceived)
        clear()
        // Cancelling the source releases the socket; without this the
        // underlying connection stays open after the stream has failed.
        void reader.cancel(error).catch(() => {})
        onTimeout?.(error)
        controller.error(error)
      }

      const arm = (): void => {
        clear()
        if (settled) return
        timer = setTimeout(fail, idleMs)
      }

      const pump = async (): Promise<void> => {
        arm()
        try {
          while (!settled) {
            const { done, value } = await reader.read()
            if (settled) return
            if (done) {
              clear()
              settled = true
              controller.close()
              return
            }
            if (value !== undefined) {
              bytesReceived += value.byteLength ?? value.length ?? 0
              controller.enqueue(value)
            }
            arm()
          }
        } catch (error) {
          if (settled) return
          settled = true
          clear()
          controller.error(error)
        }
      }

      void pump()
    },
    cancel(reason) {
      settled = true
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      return reader.cancel(reason)
    },
  })
}
