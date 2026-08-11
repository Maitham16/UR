import { getSessionId } from '../bootstrap/state.js'

const DEFAULT_MAX_WEB_SEARCHES = 200
const DEFAULT_SUBAGENT_ADVISORY = 100

type WebSearchBudgetState = { used: number; reserved: number }
type SubagentBudgetState = { count: number; lastWarningAt: number }

const webSearchBudgets = new Map<string, WebSearchBudgetState>()
const subagentBudgets = new Map<string, SubagentBudgetState>()

function positiveIntegerEnv(
  names: readonly string[],
  fallback: number,
): number {
  for (const name of names) {
    const raw = process.env[name]
    if (raw === undefined || raw === '') continue
    if (raw.toLowerCase() === 'unlimited') return Number.POSITIVE_INFINITY
    const value = Number(raw)
    if (Number.isSafeInteger(value) && value > 0) return value
  }
  return fallback
}

export function getMaxWebSearchesPerSession(): number {
  return positiveIntegerEnv(
    [
      'UR_MAX_WEB_SEARCHES_PER_SESSION',
      'CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION',
    ],
    DEFAULT_MAX_WEB_SEARCHES,
  )
}

export function getWebSearchBudgetSnapshot(sessionId = getSessionId()): {
  limit: number
  used: number
  reserved: number
  remaining: number
} {
  const limit = getMaxWebSearchesPerSession()
  const state = webSearchBudgets.get(sessionId) ?? { used: 0, reserved: 0 }
  return {
    limit,
    used: state.used,
    reserved: state.reserved,
    remaining: Math.max(0, limit - state.used - state.reserved),
  }
}

/**
 * Atomically reserve up to `requested` provider-side searches. The caller must
 * finalize once, refunding unused capacity. This keeps concurrent tool calls
 * from racing past the per-session ceiling.
 */
export function reserveWebSearchBudget(
  requested: number,
  sessionId = getSessionId(),
): {
  granted: number
  limit: number
  finalize(actualUses: number): void
} {
  const snapshot = getWebSearchBudgetSnapshot(sessionId)
  const granted = Math.max(0, Math.min(requested, snapshot.remaining))
  const state = webSearchBudgets.get(sessionId) ?? { used: 0, reserved: 0 }
  state.reserved += granted
  webSearchBudgets.set(sessionId, state)

  let finalized = false
  return {
    granted,
    limit: snapshot.limit,
    finalize(actualUses: number): void {
      if (finalized) return
      finalized = true
      state.reserved = Math.max(0, state.reserved - granted)
      const normalized = Number.isFinite(actualUses)
        ? Math.max(0, Math.min(granted, Math.floor(actualUses)))
        : granted
      state.used += normalized
    },
  }
}

export function recordSubagentSpawn(
  sessionId = getSessionId(),
): {
  count: number
  advisoryLimit: number
  shouldWarn: boolean
} {
  const advisoryLimit = positiveIntegerEnv(
    ['UR_SUBAGENT_SPAWN_ADVISORY_PER_SESSION'],
    DEFAULT_SUBAGENT_ADVISORY,
  )
  const state = subagentBudgets.get(sessionId) ?? {
    count: 0,
    lastWarningAt: 0,
  }
  state.count++
  // Advisory only: warn once at the limit and then every 25 extra spawns.
  const shouldWarn =
    Number.isFinite(advisoryLimit) &&
    state.count >= advisoryLimit &&
    (state.lastWarningAt === 0 || state.count - state.lastWarningAt >= 25)
  if (shouldWarn) state.lastWarningAt = state.count
  subagentBudgets.set(sessionId, state)
  return { count: state.count, advisoryLimit, shouldWarn }
}

export function resetSessionBudgetsForTests(): void {
  webSearchBudgets.clear()
  subagentBudgets.clear()
}
