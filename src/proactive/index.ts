import { createSignal } from '../utils/signal.js'

export type ProactiveActivationSource = string

type ProactiveState = {
  active: boolean
  paused: boolean
  contextBlocked: boolean
  activationSource: ProactiveActivationSource | null
  nextTickAt: number | null
}

const state: ProactiveState = {
  active: false,
  paused: false,
  contextBlocked: false,
  activationSource: null,
  nextTickAt: null,
}

const proactiveChanged = createSignal()

function updateState(update: Partial<ProactiveState>): void {
  let changed = false
  for (const [key, value] of Object.entries(update) as Array<
    [keyof ProactiveState, ProactiveState[keyof ProactiveState]]
  >) {
    if (state[key] !== value) {
      // Each property is assigned a value from the same property in
      // Partial<ProactiveState>; Object.entries loses that correlation.
      ;(state as Record<keyof ProactiveState, unknown>)[key] = value
      changed = true
    }
  }
  if (changed) proactiveChanged.emit()
}

export function isProactiveActive(): boolean {
  return state.active
}

export function isProactivePaused(): boolean {
  return state.paused
}

export function isContextBlocked(): boolean {
  return state.contextBlocked
}

export function getActivationSource(): ProactiveActivationSource | null {
  return state.activationSource
}

export function getNextTickAt(): number | null {
  return state.nextTickAt
}

export function shouldTick(): boolean {
  return state.active && !state.paused && !state.contextBlocked
}

export function activateProactive(source: ProactiveActivationSource): void {
  updateState({
    active: true,
    paused: false,
    contextBlocked: false,
    activationSource: source,
  })
}

export function deactivateProactive(): void {
  updateState({
    active: false,
    paused: false,
    contextBlocked: false,
    activationSource: null,
    nextTickAt: null,
  })
}

export function pauseProactive(): void {
  if (!state.active) return
  updateState({ paused: true, nextTickAt: null })
}

export function resumeProactive(): void {
  if (!state.active) return
  updateState({ paused: false })
}

/**
 * Stops the automatic tick loop after an API/context failure. A successful
 * response, /clear, or compaction clears the block at the existing call sites.
 */
export function setContextBlocked(blocked: boolean): void {
  updateState({
    contextBlocked: blocked,
    ...(blocked ? { nextTickAt: null } : {}),
  })
}

export function setNextTickAt(nextTickAt: number | null): void {
  updateState({ nextTickAt })
}

export const subscribeToProactiveChanges = proactiveChanged.subscribe

/** Test-only state reset that is deliberately equivalent to deactivation. */
export function resetProactiveStateForTests(): void {
  deactivateProactive()
}
