import { useEffect, useRef } from 'react'
import { TICK_TAG } from '../constants/xml.js'
import {
  shouldTick,
  subscribeToProactiveChanges,
} from './index.js'

// Yield once so the completed turn and any already-pending queue mutation can
// settle before the next autonomous turn is submitted.
export const PROACTIVE_TICK_DELAY_MS = 0

export type UseProactiveOptions = {
  isLoading: boolean
  queuedCommandsLength: number
  hasActiveLocalJsxUI: boolean
  isInPlanMode: boolean
  onSubmitTick: (prompt: string) => void
  onQueueTick: (prompt: string) => void
}

export function createProactiveTick(date = new Date()): string {
  return `<${TICK_TAG}>${date.toLocaleTimeString()}</${TICK_TAG}>`
}

/**
 * Keeps an interactive proactive session alive while it is idle. Only one
 * timer may exist at a time. Work that appears while the timer is pending wins:
 * the tick is queued behind it instead of racing a direct submission.
 */
export function useProactive(options: UseProactiveOptions): void {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let disposed = false

    const clearTimer = (): void => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }

    const canSchedule = (): boolean => {
      const current = optionsRef.current
      return (
        shouldTick() &&
        !current.isLoading &&
        current.queuedCommandsLength === 0 &&
        !current.hasActiveLocalJsxUI &&
        !current.isInPlanMode
      )
    }

    const schedule = (): void => {
      if (disposed || timerRef.current !== null) return
      if (!canSchedule()) {
        clearTimer()
        return
      }

      timerRef.current = setTimeout(() => {
        timerRef.current = null
        if (disposed || !shouldTick()) return

        const current = optionsRef.current
        if (
          current.isLoading ||
          current.hasActiveLocalJsxUI ||
          current.isInPlanMode
        ) return

        const tick = createProactiveTick()
        // queuedCommandsLength may have changed after this timer was armed.
        // Preserve user/task ordering in that race.
        if (current.queuedCommandsLength === 0) current.onSubmitTick(tick)
        else current.onQueueTick(tick)
      }, PROACTIVE_TICK_DELAY_MS)
    }

    let wasRunnable = shouldTick()
    const unsubscribe = subscribeToProactiveChanges(() => {
      const runnable = shouldTick()
      if (runnable === wasRunnable) return
      wasRunnable = runnable
      if (runnable) schedule()
      else clearTimer()
    })

    schedule()
    return () => {
      disposed = true
      unsubscribe()
      clearTimer()
    }
  }, [
    options.isLoading,
    options.queuedCommandsLength,
    options.hasActiveLocalJsxUI,
    options.isInPlanMode,
  ])
}
