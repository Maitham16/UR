import { expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { indexWorkspace, readFileSafe, searchFiles } from '../src/ur/fileops.ts'

test('read/search/index skip node_modules; reject missing/binary', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'urf-'))
  writeFileSync(join(tmp, 'a.ts'), 'const hello = 1\n')
  mkdirSync(join(tmp, 'node_modules'))
  writeFileSync(join(tmp, 'node_modules', 'x.js'), 'skip me')
  expect(readFileSafe(tmp, 'a.ts').ok).toBe(true)
  expect(readFileSafe(tmp, 'nope.ts').ok).toBe(false)
  expect(searchFiles(tmp, 'hello').length).toBe(1)
  const indexed = indexWorkspace(tmp)
  expect(indexed.count).toBeGreaterThanOrEqual(1)
  expect(indexed.written).toBe(true)
  rmSync(tmp, { recursive: true, force: true })
})

test('read rejects path escapes and preserves workspace filenames with spaces', () => {
  const root = mkdtempSync(join(tmpdir(), 'urf-containment-'))
  const workspace = join(root, 'workspace')
  const outside = join(root, 'outside.md')
  mkdirSync(workspace)
  writeFileSync(outside, 'outside secret\n')
  writeFileSync(join(workspace, 'report with spaces.md'), 'inside report\n')
  symlinkSync(outside, join(workspace, 'outside-link.md'))
  symlinkSync(
    join(workspace, 'report with spaces.md'),
    join(workspace, 'inside-link.md'),
  )

  try {
    expect(readFileSafe(workspace, outside)).toEqual({
      ok: false,
      error: 'absolute paths are not allowed; use a workspace-relative path',
    })
    expect(readFileSafe(workspace, '../outside.md')).toEqual({
      ok: false,
      error: 'parent path traversal (..) is not allowed',
    })
    expect(readFileSafe(workspace, 'nested/../report with spaces.md')).toEqual({
      ok: false,
      error: 'parent path traversal (..) is not allowed',
    })
    expect(readFileSafe(workspace, 'outside-link.md')).toEqual({
      ok: false,
      error: 'path resolves outside the workspace: outside-link.md',
    })
    expect(readFileSafe(workspace, 'report with spaces.md')).toEqual({
      ok: true,
      content: 'inside report\n',
    })
    expect(readFileSafe(workspace, 'inside-link.md')).toEqual({
      ok: true,
      content: 'inside report\n',
    })
    expect(searchFiles(workspace, 'outside secret')).toEqual([])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('index reports persistence failure instead of claiming success', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'urf-index-failure-'))
  writeFileSync(join(workspace, '.ur'), 'blocks index directory\n')
  try {
    const result = indexWorkspace(workspace)
    expect(result.written).toBe(false)
    expect(result.error).toBeTruthy()
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})
