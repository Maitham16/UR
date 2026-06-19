/**
 * Type declarations for `bun:bundle` — Bun's compile-time feature flag module.
 *
 * At build time, Bun replaces `feature('FLAG_NAME')` calls with `true` or `false`
 * based on the build configuration, enabling dead-code elimination.
 *
 * For local development without the Bun bundler, all flags default to `false`.
 */
declare module 'bun:bundle' {
  /**
   * Returns whether a compile-time feature flag is enabled.
   * During development (unbundled), this always returns `false`.
   */
  export function feature(flag: string): boolean
}
