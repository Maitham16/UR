// The standalone build sets this explicitly. Bun.embeddedFiles contains assets,
// not the compiled JavaScript, and can be empty in a valid native executable.
declare const UR_NATIVE_BUILD: boolean

/**
 * Detects if the current runtime is Bun.
 * Returns true when:
 * - Running a JS file via the `bun` command
 * - Running a Bun-compiled standalone executable
 */
export function isRunningWithBun(): boolean {
  // https://bun.com/guides/util/detect-bun
  return process.versions.bun !== undefined
}

/**
 * Detects if running as a Bun-compiled standalone executable.
 * The asset fallback preserves compatibility with older native distributions.
 */
export function isInBundledMode(): boolean {
  return (
    (typeof UR_NATIVE_BUILD !== 'undefined' && UR_NATIVE_BUILD) ||
    (typeof Bun !== 'undefined' &&
      Array.isArray(Bun.embeddedFiles) &&
      Bun.embeddedFiles.length > 0)
  )
}
