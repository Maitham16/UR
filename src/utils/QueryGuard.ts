/**
 * Synchronous state machine for the query lifecycle, compatible with
 * React's `useSyncExternalStore`.
 *
 * Three states:
 *   idle        → no query, safe to dequeue and process
 *   dispatching → an item was dequeued, async chain hasn't reached onQuery yet
 *   running     → onQuery called tryStart(), query is executing
 *
 * Transitions:
 *   idle → dispatching  (reserve)
 *   dispatching → running  (tryStart)
 *   idle → running  (tryStart, for direct user submissions)
 *   running → idle  (end / forceEnd)
 *   dispatching → idle  (cancelReservation, when processQueueIfReady fails)
 *
 * `isActive` returns true for both dispatching and running, preventing
 * re-entry from the queue processor during the async gap.
 *
 * Usage with React:
 *   const queryGuard = useRef(new QueryGuard()).current
 *   const isQueryActive = useSyncExternalStore(
 *     queryGuard.subscribe,
 *     queryGuard.getSnapshot,
 *   )
 */
import { createSignal } from './signal.js'

/**
 * How long `dispatching` may last before it is treated as abandoned.
 *
 * `dispatching` is the gap between reserve() and tryStart() — a few synchronous
 * statements plus the awaits inside processUserInput. It has no owner: if that
 * chain dies in a way the caller's finally cannot observe (a torn-down React
 * tree, a rejected microtask, a native crash in an awaited tool), nothing calls
 * cancelReservation() and `isActive` stays true forever. The UI then shows
 * "working" indefinitely for a prompt that is not running anywhere.
 *
 * Generous by design: a slash command awaiting a slow tool legitimately sits
 * here for seconds. This is a stuck detector, not a deadline.
 */
export const DISPATCH_STUCK_MS = 120_000

export class QueryGuard {
  private _status: 'idle' | 'dispatching' | 'running' = 'idle'
  private _generation = 0
  private _reservationGeneration = 0
  private _reservationAbort: (() => void) | null = null
  private _changed = createSignal()
  /** When the current status was entered. Drives stuck detection. */
  private _statusSince = 0
  private _now: () => number = () => Date.now()

  /** Override the clock. Tests only — production always uses Date.now. */
  setClockForTests(now: () => number): void {
    this._now = now
  }

  /**
   * Reserve the guard for queue processing. Transitions idle → dispatching.
   * Returns false if not idle (another query or dispatch in progress).
   */
  reserve(onExpired?: () => void): number | null {
    if (this._status !== 'idle') return null
    this._status = 'dispatching'
    const token = ++this._reservationGeneration
    this._reservationAbort = onExpired ?? null
    this._statusSince = this._now()
    this._notify()
    return token
  }

  /**
   * Cancel a reservation when processQueueIfReady had nothing to process.
   * Transitions dispatching → idle.
   */
  cancelReservation(token?: number): void {
    if (this._status !== 'dispatching') return
    if (token !== undefined && token !== this._reservationGeneration) return
    this._status = 'idle'
    this._reservationAbort = null
    this._statusSince = this._now()
    this._notify()
  }

  /**
   * Start a query. Returns the generation number on success,
   * or null if a query is already running (concurrent guard).
   * Accepts transitions from both idle (direct user submit)
   * and dispatching (queue processor path).
   */
  tryStart(reservationToken?: number): number | null {
    if (this._status === 'running') return null
    if (this._status === 'dispatching') {
      if (reservationToken !== this._reservationGeneration) return null
    } else if (reservationToken !== undefined) {
      // The reservation expired or was cancelled while preprocessing. A late
      // continuation must not start after another prompt has taken ownership.
      return null
    }
    this._status = 'running'
    this._reservationAbort = null
    this._statusSince = this._now()
    ++this._generation
    this._notify()
    return this._generation
  }

  /**
   * End a query. Returns true if this generation is still current
   * (meaning the caller should perform cleanup). Returns false if a
   * newer query has started (stale finally block from a cancelled query).
   */
  end(generation: number): boolean {
    if (this._generation !== generation) return false
    if (this._status !== 'running') return false
    this._status = 'idle'
    this._statusSince = this._now()
    this._notify()
    return true
  }

  /**
   * Force-end the current query regardless of generation.
   * Used by onCancel where any running query should be terminated.
   * Increments generation so stale finally blocks from the cancelled
   * query's promise rejection will see a mismatch and skip cleanup.
   */
  forceEnd(): void {
    if (this._status === 'idle') return
    this._status = 'idle'
    this._statusSince = this._now()
    ++this._generation
    ++this._reservationGeneration
    this._reservationAbort = null
    this._notify()
  }

  /**
   * Is the guard active (dispatching or running)?
   * Always synchronous — not subject to React state batching delays.
   */
  get isActive(): boolean {
    return this._status !== 'idle'
  }

  /** Current lifecycle state. Exposed so callers can report accurately. */
  get status(): 'idle' | 'dispatching' | 'running' {
    return this._status
  }

  /** How long the guard has held its current state, in ms. */
  heldForMs(): number {
    if (this._status === 'idle') return 0
    return Math.max(0, this._now() - this._statusSince)
  }

  /**
   * True when `dispatching` has outlived any plausible hand-off to tryStart().
   * `running` is deliberately excluded: a long query is legitimate and is
   * bounded by the provider request and stream-inactivity timeouts instead.
   */
  isDispatchStuck(thresholdMs: number = DISPATCH_STUCK_MS): boolean {
    return this._status === 'dispatching' && this.heldForMs() >= thresholdMs
  }

  /**
   * Release an abandoned reservation. Returns true when something was
   * released, so the caller can surface an accurate reason rather than
   * leaving the UI showing work that is not happening.
   */
  releaseIfStuck(thresholdMs: number = DISPATCH_STUCK_MS): boolean {
    if (!this.isDispatchStuck(thresholdMs)) return false
    const abort = this._reservationAbort
    this._status = 'idle'
    ++this._reservationGeneration
    this._reservationAbort = null
    this._statusSince = this._now()
    this._notify()
    abort?.()
    return true
  }

  get generation(): number {
    return this._generation
  }

  // --
  // useSyncExternalStore interface

  /** Subscribe to state changes. Stable reference — safe as useEffect dep. */
  subscribe = this._changed.subscribe

  /** Snapshot for useSyncExternalStore. Returns `isActive`. */
  getSnapshot = (): boolean => {
    return this._status !== 'idle'
  }

  private _notify(): void {
    this._changed.emit()
  }
}
