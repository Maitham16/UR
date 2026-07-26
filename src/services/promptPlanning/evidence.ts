import { lstatSync, readdirSync, readlinkSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

export type WorkspaceFileState = {
  cwd: string
  files: Map<string, string>
}

const SKIPPED_DIRS = new Set([
  '.git',
  'node_modules',
  '.turbo',
  '.cache',
  '.next',
  '.vite',
])

function normalizePath(value: string): string {
  return value.split(sep).join('/')
}

function shouldSkipDir(name: string): boolean {
  return SKIPPED_DIRS.has(name)
}

function fingerprint(path: string): string | null {
  try {
    const stat = lstatSync(path, { bigint: true })
    if (stat.isSymbolicLink()) {
      return `link:${readlinkSync(path)}`
    }
    if (!stat.isFile()) return null
    // Nanosecond mtime avoids missing rapid same-size rewrites. ctime also
    // detects a rewrite whose mtime was deliberately restored afterward.
    return `${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.mode}:${stat.ino}`
  } catch {
    return null
  }
}

function walk(cwd: string, dir: string, files: Map<string, string>): void {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (entry.isDirectory() && shouldSkipDir(entry.name)) continue
    const absolute = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(cwd, absolute, files)
      continue
    }
    const value = fingerprint(absolute)
    if (value === null) continue
    files.set(normalizePath(relative(cwd, absolute)), value)
  }
}

export function captureWorkspaceFileState(cwd: string): WorkspaceFileState {
  const files = new Map<string, string>()
  walk(cwd, cwd, files)
  return { cwd, files }
}

export function diffWorkspaceFileState(
  before: WorkspaceFileState,
  after: WorkspaceFileState,
): string[] {
  const changed = new Set<string>()
  for (const [file, value] of after.files) {
    if (before.files.get(file) !== value) changed.add(file)
  }
  for (const file of before.files.keys()) {
    if (!after.files.has(file)) changed.add(file)
  }
  return [...changed].sort()
}
