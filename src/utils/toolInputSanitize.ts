/**
 * Drops empty-string parameter names from tool input (occasional model
 * glitch) so strict schemas don't reject the call with
 * "An unexpected parameter `` was provided".
 */
export function stripEmptyParameterNames(input: unknown): {
  input: unknown
  stripped: boolean
} {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { input, stripped: false }
  }
  if (!('' in input)) return { input, stripped: false }
  const { '': _dropped, ...rest } = input as Record<string, unknown>
  return { input: rest, stripped: true }
}

type UnrecognizedKeysIssue = {
  code: string
  path: PropertyKey[]
  keys?: string[]
}

/**
 * Removes keys a Zod schema flagged as unrecognized (hallucinated extra
 * parameters like `title`/`description` on a Write call) so the call can be
 * re-validated instead of failing with "An unexpected parameter X was
 * provided". Only touches keys Zod itself reported; nested paths supported.
 */
export function stripUnrecognizedKeys(
  input: unknown,
  issues: readonly UnrecognizedKeysIssue[],
): { input: unknown; stripped: string[] } {
  const unrecognized = issues.filter(issue => issue.code === 'unrecognized_keys')
  if (unrecognized.length === 0 || typeof input !== 'object' || input === null) {
    return { input, stripped: [] }
  }
  const clone = structuredClone(input) as Record<string, unknown>
  const stripped: string[] = []
  for (const issue of unrecognized) {
    let target: unknown = clone
    for (const segment of issue.path) {
      if (target === null || typeof target !== 'object') {
        target = null
        break
      }
      target = (target as Record<PropertyKey, unknown>)[segment]
    }
    if (target !== null && typeof target === 'object') {
      const record = target as Record<string, unknown>
      for (const key of issue.keys ?? []) {
        if (key in record) {
          delete record[key]
          stripped.push(key)
        }
      }
    }
  }
  return { input: clone, stripped }
}
