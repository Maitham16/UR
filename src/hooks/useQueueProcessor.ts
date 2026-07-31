import { useEffect, useSyncExternalStore } from 'react'
import type { QueuedCommand } from '../types/textInputTypes.js'
import {
  getCommandQueueSnapshot,
  subscribeToCommandQueue,
} from '../utils/messageQueueManager.js'
import { DISPATCH_STUCK_MS, type QueryGuard } from '../utils/QueryGuard.js'
import { processQueueIfReady } from '../utils/queueProcessor.js'
import { logForDebugging } from '../utils/debug.js'

/** How often to re-check an outstanding reservation. */
const DISPATCH_STUCK_CHECK_MS = 5_000

type UseQueueProcessorParams = {
  executeQueuedInput: (commands: QueuedCommand[]) => Promise<void>
  hasActiveLocalJsxUI: boolean
  queryGuard: QueryGuard
  reportQueueError: (error: unknown) => void
}

/**
 * Hook that processes queued commands when conditions are met.
 *
 * Uses a single unified command queue (module-level store). Priority determines
 * processing order: 'now' > 'next' (user input) > 'later' (task notifications).
 * The dequeue() function handles priority ordering automatically.
 *
 * Processing triggers when:
 * - No query active (queryGuard — reactive via useSyncExternalStore)
 * - Queue has items
 * - No active local JSX UI blocking input
 */
export function useQueueProcessor({
  executeQueuedInput,
  hasActiveLocalJsxUI,
  queryGuard,
  reportQueueError,
}: UseQueueProcessorParams): void {
  // Subscribe to the query guard. Re-renders when a query starts or ends
  // (or when reserve/cancelReservation transitions dispatching state).
  const isQueryActive = useSyncExternalStore(
    queryGuard.subscribe,
    queryGuard.getSnapshot,
  )

  // Subscribe to the unified command queue via useSyncExternalStore.
  // This guarantees re-render when the store changes, bypassing
  // React context propagation delays that cause missed notifications in Ink.
  const queueSnapshot = useSyncExternalStore(
    subscribeToCommandQueue,
    getCommandQueueSnapshot,
  )

  // `dispatching` has no owner: it is the gap between reserve() and tryStart().
  // handlePromptSubmit's finally normally releases it, but if that chain dies
  // where the finally cannot observe it, isActive stays true and the UI shows
  // "working" forever for a prompt that is running nowhere — and the queue
  // behind it never drains. Poll only while a reservation is outstanding, so
  // there is no timer in the idle case.
  useEffect(() => {
    if (queryGuard.status !== 'dispatching') return
    const timer = setInterval(() => {
      if (queryGuard.releaseIfStuck()) {
        const message = `Prompt dispatch timed out after ${DISPATCH_STUCK_MS}ms before the model call began; the pending dispatch was cancelled.`
        logForDebugging(message)
        reportQueueError(new Error(message))
      }
    }, DISPATCH_STUCK_CHECK_MS)
    return () => clearInterval(timer)
  }, [isQueryActive, queryGuard, reportQueueError])

  useEffect(() => {
    if (isQueryActive) return
    if (hasActiveLocalJsxUI) return
    if (queueSnapshot.length === 0) return

    // Reservation is now owned by handlePromptSubmit (inside executeUserInput's
    // try block). The sync chain executeQueuedInput → handlePromptSubmit →
    // executeUserInput → queryGuard.reserve() runs before the first real await,
    // so by the time React re-runs this effect (due to the dequeue-triggered
    // snapshot change), isQueryActive is already true (dispatching) and the
    // guard above returns early. handlePromptSubmit's finally releases the
    // reservation via cancelReservation() (no-op if onQuery already ran end()).
    const result = processQueueIfReady({ executeInput: executeQueuedInput })
    // A queue item has already been claimed, so its promise must never be
    // detached without an observer. Automatic retry is unsafe because a tool
    // effect may already have occurred before the rejection.
    void result.completion?.catch(reportQueueError)
  }, [
    queueSnapshot,
    isQueryActive,
    executeQueuedInput,
    hasActiveLocalJsxUI,
    queryGuard,
    reportQueueError,
  ])
}
