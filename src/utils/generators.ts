const NO_VALUE = Symbol('NO_VALUE')

export async function lastX<A>(as: AsyncGenerator<A>): Promise<A> {
  let lastValue: A | typeof NO_VALUE = NO_VALUE
  for await (const a of as) {
    lastValue = a
  }
  if (lastValue === NO_VALUE) {
    throw new Error('No items in generator')
  }
  return lastValue
}

export async function returnValue<A>(
  as: AsyncGenerator<unknown, A>,
): Promise<A> {
  let e
  do {
    e = await as.next()
  } while (!e.done)
  return e.value
}

type QueuedGenerator<A> = {
  done: boolean | void
  value: A | void
  generator: AsyncGenerator<A, void>
  promise: Promise<QueuedGenerator<A>>
}

/**
 * Run generators concurrently up to a cap, yielding values as they arrive.
 *
 * Cancellation is the hard part. A consumer that stops early — an abort, a
 * `break`, or a sibling that threw — used to leave every other generator
 * suspended mid-step with nothing to resume or close it: their `finally`
 * blocks never ran, so subprocesses, streams, and in-progress bookkeeping
 * outlived the batch that owned them while the UI reported it as finished.
 * Whichever way this loop exits, every generator it started is now closed.
 */
export async function* all<A>(
  generators: AsyncGenerator<A, void>[],
  concurrencyCap = Infinity,
): AsyncGenerator<A, void> {
  const next = (generator: AsyncGenerator<A, void>) => {
    const promise: Promise<QueuedGenerator<A>> = generator
      .next()
      .then(({ done, value }) => ({
        done,
        value,
        generator,
        promise,
      }))
    return promise
  }
  const waiting = [...generators]
  const promises = new Set<Promise<QueuedGenerator<A>>>()
  // Generators that have been started and not yet run to completion. These are
  // the ones with pending cleanup if the loop exits early.
  const running = new Set<AsyncGenerator<A, void>>()

  const start = (generator: AsyncGenerator<A, void>): void => {
    running.add(generator)
    promises.add(next(generator))
  }

  try {
    // Start initial batch up to concurrency cap
    while (promises.size < concurrencyCap && waiting.length > 0) {
      start(waiting.shift()!)
    }

    while (promises.size > 0) {
      const { done, value, generator, promise } = await Promise.race(promises)
      promises.delete(promise)

      if (!done) {
        promises.add(next(generator))
        // TODO: Clean this up
        if (value !== undefined) {
          yield value as Awaited<A>
        }
      } else {
        running.delete(generator)
        if (waiting.length > 0) {
          // Start a new generator when one finishes
          start(waiting.shift()!)
        }
      }
    }
  } finally {
    // Closing a generator runs its `finally` blocks, which is what releases
    // whatever it owns. Not awaited: a generator parked on a slow request
    // would otherwise hold up the abort that is trying to cancel it, and its
    // cleanup runs either way once that request settles.
    for (const generator of running) {
      void generator.return(undefined).catch(() => {})
    }
    // Generators that never started have no body to unwind, but closing them
    // keeps a later accidental `next()` from running work nobody is reading.
    for (const generator of waiting) {
      void generator.return(undefined).catch(() => {})
    }
    // An in-flight step that rejects after we stop reading would otherwise
    // surface as an unhandled rejection and take the process down.
    for (const promise of promises) {
      void promise.catch(() => {})
    }
  }
}

export async function toArray<A>(
  generator: AsyncGenerator<A, void>,
): Promise<A[]> {
  const result: A[] = []
  for await (const a of generator) {
    result.push(a)
  }
  return result
}

export async function* fromArray<T>(values: T[]): AsyncGenerator<T, void> {
  for (const value of values) {
    yield value
  }
}
