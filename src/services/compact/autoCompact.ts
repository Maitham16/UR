import { feature } from 'bun:bundle'
import { markPostCompaction } from 'src/bootstrap/state.js'
import { getSdkBetas } from '../../bootstrap/state.js'
import type { QuerySource } from '../../constants/querySource.js'
import type { ToolUseContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import { getGlobalConfig } from '../../utils/config.js'
import { getContextWindowForModel } from '../../utils/context.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { hasExactErrorMessage } from '../../utils/errors.js'
import type { CacheSafeParams } from '../../utils/forkedAgent.js'
import { logError } from '../../utils/log.js'
import { tokenCountWithEstimation } from '../../utils/tokens.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import { getMaxOutputTokensForModel } from '../api/ur.js'
import { notifyCompaction } from '../api/promptCacheBreakDetection.js'
import { setLastSummarizedMessageId } from '../SessionMemory/sessionMemoryUtils.js'
import {
  type CompactionResult,
  compactConversation,
  ERROR_MESSAGE_USER_ABORT,
  type RecompactionInfo,
} from './compact.js'
import { suppressCompactWarning } from './compactWarningState.js'
import { runPostCompactCleanup } from './postCompactCleanup.js'
import { trySessionMemoryCompaction } from './sessionMemoryCompact.js'

// Reserve this many tokens for output during compaction
// Based on p99.99 of compact summary output being 17,387 tokens.
const MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000

// Returns the context window size minus the max output tokens for the model
export function getEffectiveContextWindowSize(model: string): number {
  const reservedTokensForSummary = Math.min(
    getMaxOutputTokensForModel(model),
    MAX_OUTPUT_TOKENS_FOR_SUMMARY,
  )
  let contextWindow = getContextWindowForModel(model, getSdkBetas())

  const autoCompactWindow = process.env.UR_CODE_AUTO_COMPACT_WINDOW
  if (autoCompactWindow) {
    const parsed = parseInt(autoCompactWindow, 10)
    if (!isNaN(parsed) && parsed > 0) {
      contextWindow = Math.min(contextWindow, parsed)
    }
  }

  // Custom/local models and the test override can report a window smaller than
  // the summary-output reserve. Never let that turn the usable window (and all
  // thresholds derived from it) into zero or a negative number.
  return Math.max(1, contextWindow - reservedTokensForSummary)
}

export type AutoCompactTrackingState = {
  compacted: boolean
  turnCounter: number
  // Unique ID per turn
  turnId: string
  // Consecutive autocompact failures. Reset on success.
  // Used as a circuit breaker to stop retrying when the context is
  // irrecoverably over the limit (e.g., prompt_too_long).
  consecutiveFailures?: number
}

export const AUTOCOMPACT_BUFFER_TOKENS = 13_000
export const WARNING_THRESHOLD_BUFFER_TOKENS = 20_000
export const ERROR_THRESHOLD_BUFFER_TOKENS = 5_000
export const MANUAL_COMPACT_BUFFER_TOKENS = 3_000
const WARNING_THRESHOLD_FRACTION = 0.15
const ERROR_THRESHOLD_FRACTION = 0.05

// Stop trying autocompact after this many consecutive failures.
// BQ 2026-03-10: 1,279 sessions had 50+ consecutive failures (up to 3,272)
// in a single session, wasting ~250K API calls/day globally.
const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3

function validThresholdPercent(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 50 &&
    value <= 95
  )
}

function validEnvironmentThresholdPercent(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 100
  )
}

/**
 * Resolve a positive auto-compact trigger inside the usable context window.
 *
 * `effectiveContextWindow` already reserves summary output. Explicit
 * percentages therefore describe that usable window and retain the separate
 * manual-compaction reserve. The environment override wins because it exists
 * specifically to override runtime behavior in tests and diagnostics.
 */
export function resolveAutoCompactThreshold(
  effectiveContextWindow: number,
  userPercent?: number,
  envPercent?: number,
): number {
  const safeWindow = Math.max(
    1,
    Number.isFinite(effectiveContextWindow)
      ? Math.floor(effectiveContextWindow)
      : 1,
  )
  const latestSafeThreshold = Math.max(
    1,
    safeWindow - MANUAL_COMPACT_BUFFER_TOKENS,
  )
  const configuredPercent = validEnvironmentThresholdPercent(envPercent)
    ? envPercent
    : validThresholdPercent(userPercent)
      ? userPercent
      : undefined

  if (configuredPercent !== undefined) {
    const percentageThreshold = Math.floor(
      safeWindow * (configuredPercent / 100),
    )
    return Math.max(1, Math.min(percentageThreshold, latestSafeThreshold))
  }

  return Math.max(
    1,
    Math.min(safeWindow - AUTOCOMPACT_BUFFER_TOKENS, latestSafeThreshold),
  )
}

export function getAutoCompactThreshold(model: string): number {
  const effectiveContextWindow = getEffectiveContextWindowSize(model)
  const envValue = process.env.UR_AUTOCOMPACT_PCT_OVERRIDE
  const parsedEnvPercent =
    envValue === undefined ? undefined : Number.parseFloat(envValue)
  return resolveAutoCompactThreshold(
    effectiveContextWindow,
    getGlobalConfig().compactionAutoThreshold,
    parsedEnvPercent,
  )
}

export function calculateAutoCompactProgress(
  tokenUsage: number,
  threshold: number,
): {
  tokensUntilAutoCompact: number
  percentLeft: number
} {
  const safeThreshold = Math.max(
    1,
    Number.isFinite(threshold) ? threshold : 1,
  )
  const safeUsage = Number.isFinite(tokenUsage)
    ? Math.max(0, tokenUsage)
    : safeThreshold
  const tokensUntilAutoCompact = Math.max(0, safeThreshold - safeUsage)
  const percentLeft = Math.min(
    100,
    Math.max(
      0,
      Math.round((tokensUntilAutoCompact / safeThreshold) * 100),
    ),
  )
  return { tokensUntilAutoCompact, percentLeft }
}

export function calculateTokenWarningState(
  tokenUsage: number,
  model: string,
  thresholdOverride?: number,
): {
  percentLeft: number
  tokensUntilAutoCompact: number
  autoCompactThreshold: number
  isAboveWarningThreshold: boolean
  isAboveErrorThreshold: boolean
  isAboveAutoCompactThreshold: boolean
  isAtBlockingLimit: boolean
} {
  const autoCompactThreshold = getAutoCompactThreshold(model)
  const threshold =
    thresholdOverride ??
    (isAutoCompactEnabled()
      ? autoCompactThreshold
      : getEffectiveContextWindowSize(model))

  const { percentLeft, tokensUntilAutoCompact } =
    calculateAutoCompactProgress(tokenUsage, threshold)

  // Fixed 20k bands make a small-context model warn from its first token.
  // Scale the bands down for those models while preserving the established
  // 20k warning on large windows and a distinct final 5k error band.
  const warningBuffer = Math.max(
    1,
    Math.min(
      WARNING_THRESHOLD_BUFFER_TOKENS,
      Math.floor(threshold * WARNING_THRESHOLD_FRACTION),
    ),
  )
  const errorBuffer = Math.max(
    1,
    Math.min(
      ERROR_THRESHOLD_BUFFER_TOKENS,
      Math.floor(threshold * ERROR_THRESHOLD_FRACTION),
    ),
  )

  const warningThreshold = Math.max(0, threshold - warningBuffer)
  const errorThreshold = Math.max(0, threshold - errorBuffer)

  const isAboveWarningThreshold = tokenUsage >= warningThreshold
  const isAboveErrorThreshold = tokenUsage >= errorThreshold

  const isAboveAutoCompactThreshold =
    thresholdOverride === undefined &&
    isAutoCompactEnabled() &&
    tokenUsage >= autoCompactThreshold

  const actualContextWindow = getEffectiveContextWindowSize(model)
  const defaultBlockingLimit = Math.max(
    1,
    actualContextWindow - MANUAL_COMPACT_BUFFER_TOKENS,
  )

  // Allow override for testing
  const blockingLimitOverride = process.env.UR_CODE_BLOCKING_LIMIT_OVERRIDE
  const parsedOverride = blockingLimitOverride
    ? parseInt(blockingLimitOverride, 10)
    : NaN
  const blockingLimit =
    !isNaN(parsedOverride) && parsedOverride > 0
      ? parsedOverride
      : defaultBlockingLimit

  const isAtBlockingLimit = tokenUsage >= blockingLimit

  return {
    percentLeft,
    tokensUntilAutoCompact,
    autoCompactThreshold,
    isAboveWarningThreshold,
    isAboveErrorThreshold,
    isAboveAutoCompactThreshold,
    isAtBlockingLimit,
  }
}

export function isAutoCompactEnabled(): boolean {
  if (isEnvTruthy(process.env.DISABLE_COMPACT)) {
    return false
  }
  // Allow disabling just auto-compact (keeps manual /compact working)
  if (isEnvTruthy(process.env.DISABLE_AUTO_COMPACT)) {
    return false
  }
  // Check if user has disabled auto-compact in their settings
  const userConfig = getGlobalConfig()
  return userConfig.autoCompactEnabled
}

/**
 * Whether the proactive threshold is the active context-management policy.
 * Reactive compaction and context collapse keep auto-compaction available as
 * an error-recovery mechanism, but suppress its proactive trigger.
 */
export function isProactiveAutoCompactEnabled(): boolean {
  if (!isAutoCompactEnabled()) {
    return false
  }
  if (feature('REACTIVE_COMPACT')) {
    if (getFeatureValue_CACHED_MAY_BE_STALE('tengu_cobalt_raccoon', false)) {
      return false
    }
  }
  if (feature('CONTEXT_COLLAPSE')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { isContextCollapseEnabled } =
      require('../contextCollapse/index.js') as typeof import('../contextCollapse/index.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    if (isContextCollapseEnabled()) {
      return false
    }
  }
  return true
}

export async function shouldAutoCompact(
  messages: Message[],
  model: string,
  querySource?: QuerySource,
  // Snip removes messages but the surviving assistant's usage still reflects
  // pre-snip context, so tokenCountWithEstimation can't see the savings.
  // Subtract the rough-delta that snip already computed.
  snipTokensFreed = 0,
): Promise<boolean> {
  // Recursion guards. session_memory and compact are forked agents that
  // would deadlock.
  if (querySource === 'session_memory' || querySource === 'compact') {
    return false
  }
  // marble_origami is the ctx-agent — if ITS context blows up and
  // autocompact fires, runPostCompactCleanup calls resetContextCollapse()
  // which destroys the MAIN thread's committed log (module-level state
  // shared across forks). Inside feature() so the string DCEs from
  // external builds (it's in excluded-strings.txt).
  if (feature('CONTEXT_COLLAPSE')) {
    if (querySource === 'marble_origami') {
      return false
    }
  }

  // Reactive-only and context-collapse modes own proactive context
  // management. Auto-compaction remains available to their recovery paths.
  if (!isProactiveAutoCompactEnabled()) {
    return false
  }

  const tokenCount = tokenCountWithEstimation(messages) - snipTokensFreed
  const threshold = getAutoCompactThreshold(model)
  const effectiveWindow = getEffectiveContextWindowSize(model)

  logForDebugging(
    `autocompact: tokens=${tokenCount} threshold=${threshold} effectiveWindow=${effectiveWindow}${snipTokensFreed > 0 ? ` snipFreed=${snipTokensFreed}` : ''}`,
  )

  const { isAboveAutoCompactThreshold } = calculateTokenWarningState(
    tokenCount,
    model,
  )

  return isAboveAutoCompactThreshold
}

export async function autoCompactIfNeeded(
  messages: Message[],
  toolUseContext: ToolUseContext,
  cacheSafeParams: CacheSafeParams,
  querySource?: QuerySource,
  tracking?: AutoCompactTrackingState,
  snipTokensFreed?: number,
): Promise<{
  wasCompacted: boolean
  compactionResult?: CompactionResult
  consecutiveFailures?: number
}> {
  if (isEnvTruthy(process.env.DISABLE_COMPACT)) {
    return { wasCompacted: false }
  }

  // Circuit breaker: stop retrying after N consecutive failures.
  // Without this, sessions where context is irrecoverably over the limit
  // hammer the API with doomed compaction attempts on every turn.
  if (
    tracking?.consecutiveFailures !== undefined &&
    tracking.consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES
  ) {
    return { wasCompacted: false }
  }

  const model = toolUseContext.options.mainLoopModel
  const shouldCompact = await shouldAutoCompact(
    messages,
    model,
    querySource,
    snipTokensFreed,
  )

  if (!shouldCompact) {
    return { wasCompacted: false }
  }

  const recompactionInfo: RecompactionInfo = {
    isRecompactionInChain: tracking?.compacted === true,
    turnsSincePreviousCompact: tracking?.turnCounter ?? -1,
    previousCompactTurnId: tracking?.turnId,
    autoCompactThreshold: getAutoCompactThreshold(model),
    querySource,
  }

  // EXPERIMENT: Try session memory compaction first
  const sessionMemoryResult = await trySessionMemoryCompaction(
    messages,
    toolUseContext,
    recompactionInfo.autoCompactThreshold,
  )
  if (sessionMemoryResult) {
    // Reset lastSummarizedMessageId since session memory compaction prunes messages
    // and the old message UUID will no longer exist after the REPL replaces messages
    setLastSummarizedMessageId(undefined)
    runPostCompactCleanup(querySource)
    suppressCompactWarning()
    // Reset cache read baseline so the post-compact drop isn't flagged as a
    // break. compactConversation does this internally; SM-compact doesn't.
    // BQ 2026-03-01: missing this made 20% of tengu_prompt_cache_break events
    // false positives (systemPromptChanged=true, timeSinceLastAssistantMsg=-1).
    if (feature('PROMPT_CACHE_BREAK_DETECTION')) {
      notifyCompaction(querySource ?? 'compact', toolUseContext.agentId)
    }
    markPostCompaction()
    return {
      wasCompacted: true,
      compactionResult: sessionMemoryResult,
    }
  }

  try {
    const compactionResult = await compactConversation(
      messages,
      toolUseContext,
      cacheSafeParams,
      true, // Suppress user questions for autocompact
      undefined, // No custom instructions for autocompact
      true, // isAutoCompact
      recompactionInfo,
    )

    // Reset lastSummarizedMessageId since legacy compaction replaces all messages
    // and the old message UUID will no longer exist in the new messages array
    setLastSummarizedMessageId(undefined)
    runPostCompactCleanup(querySource)
    suppressCompactWarning()

    return {
      wasCompacted: true,
      compactionResult,
      // Reset failure count on success
      consecutiveFailures: 0,
    }
  } catch (error) {
    if (!hasExactErrorMessage(error, ERROR_MESSAGE_USER_ABORT)) {
      logError(error)
    }
    // Increment consecutive failure count for circuit breaker.
    // The caller threads this through autoCompactTracking so the
    // next query loop iteration can skip futile retry attempts.
    const prevFailures = tracking?.consecutiveFailures ?? 0
    const nextFailures = prevFailures + 1
    if (nextFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) {
      logForDebugging(
        `autocompact: circuit breaker tripped after ${nextFailures} consecutive failures — skipping future attempts this session`,
        { level: 'warn' },
      )
    }
    return { wasCompacted: false, consecutiveFailures: nextFailures }
  }
}
