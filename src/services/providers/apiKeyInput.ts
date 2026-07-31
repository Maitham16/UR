/**
 * Normalisation for interactively entered provider API keys.
 *
 * A terminal delivers a bracketed paste as a single chunk that keeps whatever
 * the user copied, which routinely includes the newline that terminated the
 * copied line and, on Windows clipboards, a CR. Those characters are legal in
 * a JS string but not in an HTTP header value, so a key stored verbatim fails
 * every later request with an opaque transport error rather than a 401.
 *
 * Keys are opaque to us, so this only strips characters that cannot appear in
 * a header value. It never truncates, re-cases, or otherwise reshapes the key.
 */

// C0/C1 controls plus the Unicode line separators. Kept explicit so the intent
// survives review: these are exactly the code points that break a header value.
const CONTROL_AND_LINE_BREAKS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g

/**
 * Collapse a pasted or typed key into the single-line value that will be sent
 * as a header. Returns '' when nothing usable remains.
 */
export function sanitizeApiKeyInput(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    return ''
  }
  return raw.replace(CONTROL_AND_LINE_BREAKS, '').trim()
}

/**
 * True when the raw input carried characters that had to be removed. Callers
 * use this to tell the user their paste was cleaned rather than silently
 * altering what they believe they entered.
 */
export function apiKeyInputWasModified(raw: string): boolean {
  return sanitizeApiKeyInput(raw) !== raw
}

/**
 * A key that survives sanitisation but is still obviously unusable. This is
 * deliberately minimal — provider key formats change, so anything beyond
 * "non-empty and single-line" is left to the provider to reject.
 */
export function describeApiKeyProblem(raw: string): string | null {
  const cleaned = sanitizeApiKeyInput(raw)
  if (!cleaned) {
    return 'API key is empty.'
  }
  if (/\s/.test(cleaned)) {
    return 'API key contains whitespace. Check the value you pasted.'
  }
  return null
}
