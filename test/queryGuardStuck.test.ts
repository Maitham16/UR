import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DISPATCH_STUCK_MS, QueryGuard } from '../src/utils/QueryGuard.js'

const repoRoot = path.resolve(import.meta.dir, '..')

function guardWithClock() {
  const guard = new QueryGuard()
  let now = 0
  guard.setClockForTests(() => now)
  return {
    guard,
    advance(ms: number) {
      now += ms
    },
  }
}

describe('lifecycle is unchanged', () => {
  test('the normal queue path still reserves, starts and ends', () => {
    const guard = new QueryGuard()
    expect(guard.reserve()).toBe(true)
    expect(guard.status).toBe('dispatching')
    expect(guard.isActive).toBe(true)
    const generation = guard.tryStart()
    expect(generation).not.toBeNull()
    expect(guard.status).toBe('running')
    expect(guard.end(generation!)).toBe(true)
    expect(guard.status).toBe('idle')
    expect(guard.isActive).toBe(false)
  })

  test('a direct submit may start without reserving', () => {
    const guard = new QueryGuard()
    const generation = guard.tryStart()
    expect(generation).not.toBeNull()
    expect(guard.status).toBe('running')
  })

  test('reserve is refused while active', () => {
    const guard = new QueryGuard()
    guard.reserve()
    expect(guard.reserve()).toBe(false)
  })

  test('a stale end from a cancelled query is ignored', () => {
    const guard = new QueryGuard()
    const first = guard.tryStart()!
    guard.forceEnd()
    guard.tryStart()
    expect(guard.end(first)).toBe(false)
  })
})

describe('an abandoned reservation does not pin the UI to "working"', () => {
  test('dispatching is not considered stuck before the threshold', () => {
    const { guard, advance } = guardWithClock()
    guard.reserve()
    advance(DISPATCH_STUCK_MS - 1)
    expect(guard.isDispatchStuck()).toBe(false)
    expect(guard.releaseIfStuck()).toBe(false)
    expect(guard.isActive).toBe(true)
  })

  test('dispatching past the threshold is released and reported', () => {
    // The failure mode: the chain between reserve() and tryStart() dies where
    // handlePromptSubmit's finally cannot observe it, so isActive stays true
    // and the queue behind it never drains.
    const { guard, advance } = guardWithClock()
    guard.reserve()
    advance(DISPATCH_STUCK_MS)
    expect(guard.isDispatchStuck()).toBe(true)
    expect(guard.releaseIfStuck()).toBe(true)
    expect(guard.status).toBe('idle')
    expect(guard.isActive).toBe(false)
  })

  test('releasing notifies subscribers so the UI re-renders', () => {
    const { guard, advance } = guardWithClock()
    let notifications = 0
    guard.subscribe(() => {
      notifications++
    })
    guard.reserve()
    advance(DISPATCH_STUCK_MS)
    guard.releaseIfStuck()
    expect(notifications).toBeGreaterThanOrEqual(2)
    expect(guard.getSnapshot()).toBe(false)
  })

  test('the queue can proceed after a release', () => {
    const { guard, advance } = guardWithClock()
    guard.reserve()
    advance(DISPATCH_STUCK_MS)
    guard.releaseIfStuck()
    expect(guard.reserve()).toBe(true)
  })

  test('a second release is a no-op', () => {
    const { guard, advance } = guardWithClock()
    guard.reserve()
    advance(DISPATCH_STUCK_MS)
    expect(guard.releaseIfStuck()).toBe(true)
    expect(guard.releaseIfStuck()).toBe(false)
  })
})

describe('a legitimately long query is never interrupted', () => {
  test('running is never treated as stuck, however long it lasts', () => {
    // A long query is bounded by the provider request timeout and the stream
    // inactivity watchdog, not by this detector.
    const { guard, advance } = guardWithClock()
    guard.tryStart()
    advance(DISPATCH_STUCK_MS * 100)
    expect(guard.isDispatchStuck()).toBe(false)
    expect(guard.releaseIfStuck()).toBe(false)
    expect(guard.status).toBe('running')
  })

  test('handing off to running resets the held-for clock', () => {
    const { guard, advance } = guardWithClock()
    guard.reserve()
    advance(DISPATCH_STUCK_MS - 1)
    guard.tryStart()
    expect(guard.heldForMs()).toBe(0)
  })

  test('idle reports no held time', () => {
    const { guard, advance } = guardWithClock()
    advance(50_000)
    expect(guard.heldForMs()).toBe(0)
  })

  test('held time tracks the current state only', () => {
    const { guard, advance } = guardWithClock()
    guard.reserve()
    advance(1_500)
    expect(guard.heldForMs()).toBe(1_500)
  })
})

describe('the watchdog is wired to the queue processor', () => {
  const source = readFileSync(
    path.join(repoRoot, 'src/hooks/useQueueProcessor.ts'),
    'utf8',
  )

  test('a timer runs only while a reservation is outstanding', () => {
    expect(source).toContain("if (queryGuard.status !== 'dispatching') return")
    expect(source).toContain('setInterval')
    expect(source).toContain('clearInterval')
  })

  test('the release is logged rather than happening silently', () => {
    expect(source).toContain('releaseIfStuck()')
    expect(source).toContain('logForDebugging')
  })
})
