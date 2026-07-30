// Reactive compaction is not implemented in this distribution.
//
// query.ts does `require('./services/compact/reactiveCompact.js')` when the
// REACTIVE_COMPACT feature flag is set. That flag is not passed to the bundler,
// so the require never runs — but the module file did not exist at all, so
// enabling the flag would have failed with MODULE_NOT_FOUND before the first
// turn rather than degrading to "feature off". query.ts is @ts-nocheck, so
// nothing flagged the missing module.
//
// Live context management is services/compact/autoCompact.ts. This stub exists
// so the flag is inert rather than fatal, and so the module surface query.ts
// expects is written down somewhere.

/** Reactive compaction is unavailable, so it is never enabled. */
export function isReactiveCompactEnabled(): boolean {
  return false
}

/** Nothing is ever withheld, so no withheld prompt can be too long. */
export function isWithheldPromptTooLong(_message?: unknown): boolean {
  return false
}

/** Nothing is ever withheld, so no withheld media can be oversized. */
export function isWithheldMediaSizeError(_error?: unknown): boolean {
  return false
}

/**
 * query.ts checks the result for whether a compaction happened. Report that
 * none did, rather than returning null and throwing on property access.
 */
export async function tryReactiveCompact(..._args: unknown[]): Promise<{
  compacted: false
  messages: unknown[]
}> {
  return { compacted: false, messages: [] }
}

/**
 * /compact routes through the reactive path when this is true. It must be
 * false here, or the command would hand off to an unimplemented compactor.
 */
export function isReactiveOnlyMode(): boolean {
  return false
}

/**
 * Unreachable while isReactiveOnlyMode() is false, which is the only way
 * /compact reaches it. The caller reads `outcome.ok` and branches on failure,
 * so return that shape rather than null.
 */
export async function reactiveCompactOnPromptTooLong(
  ..._args: unknown[]
  // Both fields optional rather than a discriminated union: the caller reads
  // `.reason` and `.result` without narrowing on `.ok`.
): Promise<{ ok: boolean; result?: any; reason?: string }> {
  return {
    ok: false,
    reason: 'Reactive compaction is not available in this build.',
  }
}

export default {
  isReactiveCompactEnabled,
  isWithheldPromptTooLong,
  isWithheldMediaSizeError,
  tryReactiveCompact,
  isReactiveOnlyMode,
  reactiveCompactOnPromptTooLong,
}
