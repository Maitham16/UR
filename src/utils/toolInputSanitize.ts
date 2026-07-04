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
