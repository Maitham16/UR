const EMPTY_PATTERN_ERROR =
  'Excluded command pattern must contain at least one non-whitespace character'

/**
 * Canonicalize an exclusion before it reaches settings or matching.
 *
 * Empty entries are invalid. Even when today's exact matcher does not treat an
 * empty string as a wildcard, persisting one is ambiguous, misleading in the
 * UI, and unsafe if matching semantics change later.
 */
export function normalizeExcludedCommandPattern(pattern: string): string {
  if (typeof pattern !== 'string') {
    throw new Error(EMPTY_PATTERN_ERROR)
  }
  const normalized = pattern.trim()
  if (!normalized) {
    throw new Error(EMPTY_PATTERN_ERROR)
  }
  return normalized
}

/**
 * Normalize a settings/config list while dropping invalid legacy entries and
 * preserving first-seen order.
 */
export function sanitizeExcludedCommandPatterns(
  patterns: readonly unknown[],
): string[] {
  const normalized = new Set<string>()
  for (const pattern of patterns) {
    if (typeof pattern !== 'string') continue
    try {
      normalized.add(normalizeExcludedCommandPattern(pattern))
    } catch {
      // Old settings may already contain an empty entry. Ignore it safely.
    }
  }
  return [...normalized]
}

/**
 * Parse the raw remainder of `/sandbox exclude`.
 *
 * A single matching pair of outer quotes is syntax for grouping a pattern
 * containing spaces. Quotes inside the pattern remain untouched.
 */
export function parseExcludedCommandArgument(argument: string): string {
  const trimmed = argument.trim()
  const first = trimmed[0]
  const last = trimmed.at(-1)
  const hasOuterQuote = first === '"' || first === "'"

  if (hasOuterQuote) {
    if (first !== last || trimmed.length < 2) {
      throw new Error(
        'Excluded command pattern must use matching outer quotes',
      )
    }
    return normalizeExcludedCommandPattern(trimmed.slice(1, -1))
  }

  return normalizeExcludedCommandPattern(trimmed)
}
