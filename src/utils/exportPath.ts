import { existsSync, lstatSync, realpathSync } from 'node:fs'
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
  win32,
} from 'node:path'

function escapes(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
}

export function normalizeExportFilename(input: string): string {
  const trimmed = input.trim()
  const extension = extname(trimmed).toLowerCase()
  if (extension === '.txt' || extension === '.md') return trimmed
  if (!extension) return `${trimmed}.txt`
  return `${trimmed.slice(0, -extension.length)}.txt`
}

/**
 * Resolve an export target without allowing traversal or symlink escapes.
 * Parent directories must already exist; export never creates a hidden path.
 */
export function resolveExportPath(cwd: string, input: string): string {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('Export filename is empty')
  if (
    isAbsolute(trimmed) ||
    win32.isAbsolute(trimmed) ||
    /^[A-Za-z]:/u.test(trimmed)
  ) {
    throw new Error('Export path must be relative to the workspace')
  }
  const pathParts = trimmed.split(/[\\/]/)
  if (pathParts.some(part => part === '..')) {
    throw new Error('Export path cannot contain parent traversal (..)')
  }
  if (
    pathParts.at(-1) === '.' ||
    trimmed.endsWith('/') ||
    trimmed.endsWith('\\')
  ) {
    throw new Error('Export path must include a filename')
  }

  const root = realpathSync(cwd)
  const filename = normalizeExportFilename(trimmed)
  const target = resolve(root, filename)
  const parent = realpathSync(dirname(target))
  if (escapes(root, parent)) {
    throw new Error('Export path resolves outside the workspace')
  }
  if (existsSync(target)) {
    if (lstatSync(target).isSymbolicLink()) {
      throw new Error('Export target cannot be a symbolic link')
    }
    if (escapes(root, realpathSync(target))) {
      throw new Error('Export target resolves outside the workspace')
    }
  }
  return target
}
