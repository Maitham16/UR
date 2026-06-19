/**
 * Global type declarations for build-time macros.
 *
 * MACRO values are injected by the Bun bundler at build time via `--define`.
 * During development, these are provided by the dev script or default to
 * placeholder values.
 */

declare const MACRO: {
  /** Semantic version string, e.g. "1.0.50" */
  readonly VERSION: string
  /** ISO 8601 build timestamp, e.g. "2026-03-31T00:00:00Z" */
  readonly BUILD_TIME: string
  /** npm package URL, e.g. "@urhq-ai/ur" */
  readonly PACKAGE_URL: string
  /** Native package URL for platform-specific builds */
  readonly NATIVE_PACKAGE_URL: string | undefined
  /** Feedback channel URL */
  readonly FEEDBACK_CHANNEL: string
  /** Link explaining how to file issues */
  readonly ISSUES_EXPLAINER: string
  /** Changelog for this version */
  readonly VERSION_CHANGELOG: string
}
