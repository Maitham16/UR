import { afterEach, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  normalizeExportFilename,
  resolveExportPath,
} from '../src/utils/exportPath.js'

const dirs: string[] = []

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

test('export preserves Markdown and text extensions', () => {
  expect(normalizeExportFilename('session.md')).toBe('session.md')
  expect(normalizeExportFilename('session.txt')).toBe('session.txt')
  expect(normalizeExportFilename('session')).toBe('session.txt')
  expect(normalizeExportFilename('session.json')).toBe('session.txt')
})

test('export resolves nested workspace targets without escaping', () => {
  const cwd = tempDir('ur-export-')
  mkdirSync(join(cwd, 'reports'))
  expect(resolveExportPath(cwd, 'reports/session.md')).toBe(
    join(realpathSync(cwd), 'reports', 'session.md'),
  )
  expect(() => resolveExportPath(cwd, '../outside.md')).toThrow(
    'parent traversal',
  )
  expect(() => resolveExportPath(cwd, '/tmp/outside.md')).toThrow(
    'relative to the workspace',
  )
  expect(() => resolveExportPath(cwd, 'C:\\temp\\outside.md')).toThrow(
    'relative to the workspace',
  )
  expect(() => resolveExportPath(cwd, 'reports/')).toThrow(
    'must include a filename',
  )
})

test('export rejects existing targets and parents that are symlink escapes', () => {
  const cwd = tempDir('ur-export-')
  const outside = tempDir('ur-export-outside-')
  writeFileSync(join(outside, 'existing.md'), 'outside')
  symlinkSync(outside, join(cwd, 'linked-dir'))
  symlinkSync(join(outside, 'existing.md'), join(cwd, 'linked-file.md'))

  expect(() => resolveExportPath(cwd, 'linked-dir/new.md')).toThrow(
    'outside the workspace',
  )
  expect(() => resolveExportPath(cwd, 'linked-file.md')).toThrow(
    'symbolic link',
  )
})
