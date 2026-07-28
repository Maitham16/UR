/**
 * Pure (no side effects beyond realpath) builders for OS-level sandbox
 * profiles. Kept separate from sandboxRuntimeCompat so the wrapping logic is
 * unit-testable without spawning sandbox-exec/bwrap.
 *
 * Policy (UR's simplified sandbox): read anywhere unless an allow-list is
 * configured, write only inside configured roots, apply explicit read/write
 * denials, and optionally block all network access.
 */

import { existsSync, realpathSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, resolve } from 'node:path'

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

function normalizePath(root: string, input: string): string {
  const withoutGlob = input.replace(/[/\\]\*\*$/, '')
  const absolute = isAbsolute(withoutGlob)
    ? withoutGlob
    : resolve(root, withoutGlob)
  if (existsSync(absolute)) return safeRealpath(absolute)

  const suffix: string[] = []
  let cursor = absolute
  while (!existsSync(cursor)) {
    const parent = dirname(cursor)
    if (parent === cursor) return absolute
    suffix.unshift(basename(cursor))
    cursor = parent
  }
  return resolve(safeRealpath(cursor), ...suffix)
}

function normalizedPaths(root: string, paths: string[] | undefined): string[] {
  return [...new Set((paths ?? []).filter(Boolean).map(path => normalizePath(root, path)))]
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
  allowRead?: string[]
  denyRead?: string[]
  allowWrite?: string[]
  denyWrite?: string[]
  /**
   * Force the deny-default profile even with no read allowlist.
   *
   * Without it, a profile with no `allowRead` falls back to `(allow default)`
   * plus targeted denials. That shape is a blocklist, not a sandbox: anything
   * the denial list fails to anticipate is permitted, and it is the pattern
   * behind the 2026 Seatbelt escape write-ups. Deny-default inverts that —
   * nothing is allowed until it is granted.
   *
   * Opt-in because it can break agents that read paths outside the standard
   * runtime roots; those need an explicit `allowRead`.
   */
  denyByDefault?: boolean
}

/**
 * Build a macOS Seatbelt (sandbox-exec `-p`) profile string.
 */
export function buildSeatbeltProfile(
  root: string,
  options: SandboxProfileOptions,
): string {
  const writeRoots = normalizedPaths(
    root,
    options.allowWrite?.length ? options.allowWrite : writableRoots(root),
  )
  const writeRules = writeRoots
    .map(path => `  (subpath "${sbplString(path)}")`)
    .join('\n')

  const denyWriteRules = normalizedPaths(root, options.denyWrite)
    .map(path => `  (subpath "${sbplString(path)}")`)
    .join('\n')
  const denyReadRules = normalizedPaths(root, options.denyRead)
    .map(path => `  (subpath "${sbplString(path)}")`)
    .join('\n')

  const allowRead = normalizedPaths(root, options.allowRead)
  // Deny-default applies whenever reads are restricted, or when the caller
  // asks for it explicitly with no allowlist of its own.
  const restrictReads = allowRead.length > 0 || options.denyByDefault === true

  if (restrictReads) {
    const runtimeReadRoots = normalizedPaths(root, [
      '/System',
      '/Library',
      '/usr',
      '/bin',
      '/sbin',
      '/private/etc',
      '/dev',
      dirname(process.execPath),
      ...allowRead,
      ...writeRoots,
    ])
    const readRules = runtimeReadRoots
      .map(path => `  (subpath "${sbplString(path)}")`)
      .join('\n')
    const lines = [
      '(version 1)',
      '(deny default)',
      '(allow process*)',
      '(allow sysctl*)',
      '(allow mach*)',
      '(allow ipc*)',
      '(allow file-read*',
      readRules,
      ')',
      '(allow file-write*',
      writeRules,
      '  (subpath "/dev"))',
      '(allow file-write-data',
      '  (literal "/dev/null") (literal "/dev/zero")',
      '  (literal "/dev/random") (literal "/dev/urandom"))',
    ]
    if (denyReadRules) lines.push('(deny file-read*', denyReadRules, ')')
    if (denyWriteRules) lines.push('(deny file-write*', denyWriteRules, ')')
    if (!options.denyNetwork) lines.push('(allow network*)')
    return lines.join('\n')
  }

  // Permissive fallback: a blocklist rather than a sandbox. Reached only when
  // neither an allowRead list nor denyByDefault is configured. Prefer
  // denyByDefault; this branch exists for back-compatibility with profiles
  // that assume unrestricted reads.
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
  if (denyReadRules) lines.push('(deny file-read*', denyReadRules, ')')
  if (denyWriteRules) lines.push('(deny file-write*', denyWriteRules, ')')
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
  const allowRead = normalizedPaths(root, options.allowRead)
  const argv: string[] = []

  if (allowRead.length === 0) {
    argv.push('--ro-bind', '/', '/')
  } else {
    for (const path of normalizedPaths(root, [
      '/usr',
      '/bin',
      '/sbin',
      '/lib',
      '/lib64',
      '/etc',
      dirname(process.execPath),
      ...allowRead,
    ])) {
      if (existsSync(path)) argv.push('--ro-bind', path, path)
    }
  }

  argv.push('--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp')

  const writeRoots = normalizedPaths(
    root,
    options.allowWrite?.length ? options.allowWrite : writableRoots(root),
  )
  for (const path of writeRoots) {
    if (path === '/tmp') continue
    argv.push('--bind', path, path)
  }
  if (!writeRoots.includes(realRoot) && allowRead.length === 0) {
    argv.push('--ro-bind', realRoot, realRoot)
  }

  for (const path of normalizedPaths(root, options.denyRead)) {
    if (!existsSync(path)) continue
    const isDirectory = statSync(path).isDirectory()
    argv.push(isDirectory ? '--tmpfs' : '--ro-bind', ...(isDirectory ? [path] : ['/dev/null', path]))
  }
  for (const path of normalizedPaths(root, options.denyWrite)) {
    if (existsSync(path)) argv.push('--ro-bind', path, path)
  }
  argv.push('--die-with-parent')
  if (options.denyNetwork) {
    argv.push('--unshare-net')
  }
  return argv
}
