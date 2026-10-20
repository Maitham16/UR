import { getPlatform, type Platform } from '../platform.js'
import { quote } from '../bash/shellQuote.js'
import { resolveUrExecutable } from '../urExecutable.js'
import { isInBundledMode } from '../bundledMode.js'
import { fileURLToPath } from 'node:url'

// The supervisor is compiled code, never JavaScript supplied in the environment.
export function getPortableTimeoutEnvironment(
  _platform: Platform = getPlatform(),
): Record<string, string> {
  return {}
}

/** Provide GNU-style timeout on macOS through UR's typed internal entrypoint. */
export function getPortableTimeoutCompatibilityCommand(
  platform: Platform = getPlatform(),
  executable?: string,
): string | null {
  if (platform !== 'macos') return null
  const entry = resolveUrExecutable()
  // Source-imported shell providers also run in tests/SDK tools whose argv[1]
  // is not the UR CLI. Give that mode its own typed source entrypoint. In the
  // distributed JS bundle import.meta.url points at cli.js instead.
  const sourceEntrypoint = !isInBundledMode() && import.meta.url.endsWith('/portableTimeout.ts')
    ? fileURLToPath(new URL('../../entrypoints/timeout.ts', import.meta.url))
    : null
  const runner = quote([
    executable ?? entry.file,
    ...(sourceEntrypoint ? [sourceEntrypoint] : [...entry.baseArgs, '--internal-timeout']),
  ])
  return `if ! command -v timeout >/dev/null 2>&1; then if command -v gtimeout >/dev/null 2>&1; then timeout() { command gtimeout "$@"; }; else timeout() { command ${runner} "$@"; }; fi; fi`
}
