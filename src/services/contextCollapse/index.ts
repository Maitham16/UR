// Context collapse is not implemented in this distribution. The feature flag
// CONTEXT_COLLAPSE is not passed to the bundler, so `feature('CONTEXT_COLLAPSE')`
// is false, query.ts never requires this module, and none of it runs. Live
// context management is handled by services/compact/autoCompact.ts.
//
// This file is a stub, but it has to be a *complete* stub. query.ts calls
// applyCollapsesIfNeeded, isWithheldPromptTooLong and recoverFromOverflow, and
// none of them existed here — enabling the flag would not have degraded to a
// no-op, it would have thrown "is not a function" inside the main loop on the
// first turn. @ts-nocheck on the call site hid the mismatch from tsc.
//
// Every export below returns the shape query.ts expects for "nothing to do",
// so turning the flag on is inert rather than fatal.

/** No collapse performed; caller keeps the messages it already had. */
export const collapseContext: any = () => null

export const isContextCollapseEnabled: any = () => false

export const resetContextCollapse: any = () => undefined

export const getStats: any = () => ({
  health: {},
  collapsedSpans: 0,
  collapsedMessages: 0,
})

/**
 * query.ts awaits this and reads `.messages` / `.collapsed` from the result.
 * Returning null would throw on property access, so return an explicit
 * "no collapse applied" result instead.
 */
export const applyCollapsesIfNeeded: any = async (messages?: unknown) => ({
  messages: Array.isArray(messages) ? messages : [],
  collapsed: false,
  collapsedCount: 0,
})

/** Mirrors reactiveCompact.isWithheldPromptTooLong. Nothing is withheld here. */
export const isWithheldPromptTooLong: any = () => false

/** Drains withheld context after an overflow. Nothing is ever withheld. */
export const recoverFromOverflow: any = () => null

export default {}
