export type RollingRateLimiterOptions = {
  maxCalls: number
  windowMs: number
  maxConcurrent: number
}

export class RollingRateLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RollingRateLimitError'
  }
}

/**
 * Small in-process rolling-window and concurrency limiter for local protocol
 * adapters. Callers must release every admitted lease, normally in `finally`.
 */
export class RollingRateLimiter {
  private readonly options: RollingRateLimiterOptions
  private readonly admittedAt: number[] = []
  private active = 0

  constructor(options: RollingRateLimiterOptions) {
    if (!Number.isInteger(options.maxCalls) || options.maxCalls < 1) {
      throw new Error('maxCalls must be a positive integer')
    }
    if (!Number.isInteger(options.windowMs) || options.windowMs < 1) {
      throw new Error('windowMs must be a positive integer')
    }
    if (!Number.isInteger(options.maxConcurrent) || options.maxConcurrent < 1) {
      throw new Error('maxConcurrent must be a positive integer')
    }
    this.options = options
  }

  acquire(now = Date.now()): () => void {
    const cutoff = now - this.options.windowMs
    while (this.admittedAt.length > 0 && this.admittedAt[0]! <= cutoff) {
      this.admittedAt.shift()
    }

    if (this.active >= this.options.maxConcurrent) {
      throw new RollingRateLimitError(
        `Too many concurrent operations (limit ${this.options.maxConcurrent})`,
      )
    }
    if (this.admittedAt.length >= this.options.maxCalls) {
      throw new RollingRateLimitError(
        `Operation rate exceeded (${this.options.maxCalls} calls per ${this.options.windowMs}ms)`,
      )
    }

    this.active += 1
    this.admittedAt.push(now)
    let released = false
    return () => {
      if (released) return
      released = true
      this.active = Math.max(0, this.active - 1)
    }
  }
}

export function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined || value.trim() === '') return fallback
  if (!/^\d+$/.test(value.trim())) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback
  return Math.min(parsed, maximum)
}
