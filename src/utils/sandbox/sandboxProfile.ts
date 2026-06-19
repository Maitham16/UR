/**
 * Pure (no side effects beyond realpath) builders for OS-level sandbox
 * profiles. Kept separate from sandboxRuntimeCompat so the wrapping logic is
 * unit-testable without spawning sandbox-exec/bwrap.
 *
 * Policy (UR's simplified sandbox): read anywhere, write only inside the
 * workspace root and temp dirs, network optionally blocked. This mirrors the
 * read-everywhere/write-workspace model used by other coding agents and is the
 * sensible default for an autonomous agent's shell commands.
 */

import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'

/** POSIX single-quote a string so it survives `sh -c`. */
export function posixQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/** Escape a path for embedding inside a double-quoted Seatbelt (SBPL) literal. */
function sbplString(path: string): string {
  return path.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function safeRealpath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/**
 * Directories the sandbox allows writes to: the workspace root plus temp dirs.
 * Symlinks are resolved (e.g. /tmp -> /private/tmp on macOS) and duplicates
 * removed so the profile lists each real path once.
 */
export function writableRoots(root: string): string[] {
  const roots = new Set<string>()
  for (const candidate of [
    root,
    tmpdir(),
    '/tmp',
    '/private/tmp',
    '/private/var/folders',
  ]) {
    if (candidate) {
      roots.add(safeRealpath(candidate))
    }
  }
  return [...roots]
}

export type SandboxProfileOptions = {
  denyNetwork: boolean
}

/**
 * Build a macOS Seatbelt (sandbox-exec `-p`) profile string.
 */
export function buildSeatbeltProfile(
  root: string,
  options: SandboxProfileOptions,
): string {
  const writeRules = writableRoots(root)
    .map(path => `  (subpath "${sbplString(path)}")`)
    .join('\n')

  const lines = [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    '(allow file-write*',
    writeRules,
    '  (subpath "/dev"))',
    '(allow file-write-data',
    '  (literal "/dev/null") (literal "/dev/zero")',
    '  (literal "/dev/random") (literal "/dev/urandom"))',
  ]
  if (options.denyNetwork) {
    lines.push('(deny network*)')
  }
  return lines.join('\n')
}

/**
 * Build the bubblewrap (`bwrap`) argument vector that precedes the shell
 * invocation: read-only root, writable workspace + temp, optional net unshare.
 */
export function buildBwrapArgv(
  root: string,
  options: SandboxProfileOptions,
): string[] {
  const realRoot = safeRealpath(root)
  const argv = [
    '--ro-bind', '/', '/',
    '--dev', '/dev',
    '--proc', '/proc',
    '--tmpfs', '/tmp',
    '--bind', realRoot, realRoot,
    '--die-with-parent',
  ]
  const realTmp = safeRealpath(tmpdir())
  if (realTmp && realTmp !== '/tmp' && !realTmp.startsWith('/tmp/')) {
    argv.push('--bind', realTmp, realTmp)
  }
  if (options.denyNetwork) {
    argv.push('--unshare-net')
  }
  return argv
}
