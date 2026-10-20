/** Read the dotted build define without requiring a runtime MACRO object. */
export function getBuildVersion(fallback = 'unknown'): string {
  try {
    const version = MACRO.VERSION
    return typeof version === 'string' && version.trim() ? version : fallback
  } catch {
    // Unbundled consumers may have no build defines at all.
    return fallback
  }
}
