import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  safeWorkspacePath,
  writeWorkspaceJsonAtomic,
} from './safeWorkspacePath.js'

let root: string
let outside: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ur-safe-workspace-'))
  outside = mkdtempSync(join(tmpdir(), 'ur-safe-outside-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

describe('safeWorkspacePath', () => {
  test('accepts a normal missing descendant', () => {
    const candidate = join(root, '.ur', 'ide', 'state.json')
    expect(safeWorkspacePath(root, candidate)).toBe(candidate)
  })

  test('rejects lexical traversal outside the workspace', () => {
    expect(() => safeWorkspacePath(root, join(root, '..', 'escape.json'))).toThrow(
      /escapes the workspace/i,
    )
  })

  test('rejects a symlinked intermediate directory', () => {
    mkdirSync(join(root, '.ur'), { recursive: true })
    symlinkSync(outside, join(root, '.ur', 'ide'), 'dir')
    expect(() =>
      safeWorkspacePath(root, join(root, '.ur', 'ide', 'state.json')),
    ).toThrow(/symbolic link/i)
  })
})

describe('writeWorkspaceJsonAtomic', () => {
  test('writes valid private JSON without leaving a temporary file', () => {
    const target = join(root, '.ur', 'ide', 'state.json')
    writeWorkspaceJsonAtomic(root, target, { ok: true })
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ ok: true })
    expect(existsSync(target)).toBe(true)
  })

  test('does not follow an existing final-file symlink', () => {
    const directory = join(root, '.ur', 'ide')
    const target = join(directory, 'state.json')
    const outsideFile = join(outside, 'state.json')
    mkdirSync(directory, { recursive: true })
    writeFileSync(outsideFile, 'preserve me')
    symlinkSync(outsideFile, target, 'file')

    expect(() =>
      writeWorkspaceJsonAtomic(root, target, { overwritten: true }),
    ).toThrow(/symbolic link/i)
    expect(readFileSync(outsideFile, 'utf8')).toBe('preserve me')
  })
})
