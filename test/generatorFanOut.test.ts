import { describe, expect, test } from 'bun:test'
import { all } from '../src/utils/generators.js'

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

/**
 * Every generator `all()` starts owns something — a subprocess, a stream, an
 * in-progress marker — released in its `finally`. If the multiplexer drops a
 * generator without closing it, that release never runs while the batch that
 * owned it reports itself finished.
 */
describe('all() closes what it starts', () => {
  test('a consumer that stops early closes every running generator', async () => {
    const cleaned: string[] = []
    const make = (id: string) =>
      (async function* () {
        try {
          for (let i = 0; i < 10; i++) {
            await sleep(5)
            yield `${id}:${i}`
          }
        } finally {
          cleaned.push(id)
        }
      })()

    const seen: string[] = []
    for await (const value of all([make('a'), make('b'), make('c')], 3)) {
      seen.push(value)
      if (seen.length === 2) break
    }
    await sleep(60)

    expect(seen).toHaveLength(2)
    expect(cleaned.sort()).toEqual(['a', 'b', 'c'])
  })

  test('one generator throwing still closes its siblings', async () => {
    const cleaned: string[] = []
    const good = (id: string) =>
      (async function* () {
        try {
          for (let i = 0; i < 10; i++) {
            await sleep(5)
            yield id
          }
        } finally {
          cleaned.push(id)
        }
      })()
    const bad = (async function* () {
      try {
        await sleep(10)
        throw new Error('boom')
      } finally {
        cleaned.push('bad')
      }
    })()

    await expect(
      (async () => {
        for await (const _ of all([good('x'), bad, good('y')], 3)) {
          // drain
        }
      })(),
    ).rejects.toThrow('boom')
    await sleep(60)

    expect(cleaned.sort()).toEqual(['bad', 'x', 'y'])
  })

  test('generators still queued behind the cap never run their body', async () => {
    const started: string[] = []
    const make = (id: string) =>
      (async function* () {
        started.push(id)
        await sleep(5)
        yield id
      })()

    for await (const _ of all(
      [make('1'), make('2'), make('3'), make('4')],
      2,
    )) {
      break
    }
    await sleep(60)

    expect(started.length).toBeLessThanOrEqual(2)
    expect(started).not.toContain('4')
  })

  test('a step that rejects after cancellation is not an unhandled rejection', async () => {
    let unhandled = false
    const onUnhandled = (): void => {
      unhandled = true
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      const slowThrow = (async function* () {
        await sleep(20)
        throw new Error('late')
      })()
      const fast = (async function* () {
        yield 'v'
      })()

      for await (const _ of all([fast, slowThrow], 2)) break
      await sleep(80)

      expect(unhandled).toBe(false)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})

describe('all() fan-out semantics are unchanged', () => {
  test('delivers every value while honouring the concurrency cap', async () => {
    let live = 0
    let peak = 0
    const make = (id: string) =>
      (async function* () {
        live++
        peak = Math.max(peak, live)
        try {
          for (let i = 0; i < 3; i++) {
            await sleep(2)
            yield `${id}${i}`
          }
        } finally {
          live--
        }
      })()

    const out: string[] = []
    for await (const value of all(
      [make('a'), make('b'), make('c'), make('d')],
      2,
    )) {
      out.push(value)
    }

    expect(out).toHaveLength(12)
    expect(peak).toBeLessThanOrEqual(2)
  })
})
