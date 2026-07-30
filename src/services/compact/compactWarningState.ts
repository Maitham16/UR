import { createStore } from '../../state/store.js'

/**
 * Tracks whether the "context left until autocompact" warning should be suppressed.
 * We suppress immediately after a successful context rewrite so the UI cannot
 * render the pre-rewrite warning with stale inputs. The next query's
 * micro-compaction projection clears suppression after post-boundary messages
 * are available for a fresh estimate; it need not wait for provider usage.
 */
export const compactWarningStore = createStore<boolean>(false)

/** Suppress the compact warning. Call after successful compaction. */
export function suppressCompactWarning(): void {
  compactWarningStore.setState(() => true)
}

/** Clear suppression when the next query starts projecting current context. */
export function clearCompactWarningSuppression(): void {
  compactWarningStore.setState(() => false)
}
