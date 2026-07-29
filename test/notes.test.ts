import { expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  forget,
  forgetInAutoMemory,
  addResearch,
  listResearch,
  listMemory,
  remember,
  rememberInAutoMemory,
} from '../src/ur/notes.ts'

test('memory remember/forget', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'urn-'))
  remember(tmp, 'use bun')
  remember(tmp, 'prefer tabs')
  expect(listMemory(tmp).length).toBe(2)
  expect(forget(tmp, 'tabs')).toBe(1)
  expect(listMemory(tmp).length).toBe(1)
  rmSync(tmp, { recursive: true, force: true })
})

test('forget removes the promoted topic and its memory index pointer', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-notes-promoted-'))
  try {
    const memoryDir = join(tmp, 'auto-memory')
    const text = 'Use deterministic task ordering'
    const promoted = rememberInAutoMemory(memoryDir, text)
    expect(promoted).not.toBeNull()
    expect(forgetInAutoMemory(memoryDir, [text])).toBe(1)
    expect(existsSync(promoted!)).toBe(false)
    expect(readFileSync(join(memoryDir, 'MEMORY.md'), 'utf8')).not.toContain(
      'Use deterministic task ordering',
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('memory writes surface filesystem failures', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-notes-failure-'))
  try {
    writeFileSync(join(tmp, '.ur'), 'not a directory')
    expect(() => remember(tmp, 'must not claim success')).toThrow()
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('project memory and research reject symlinked storage', () => {
  const root = mkdtempSync(join(tmpdir(), 'ur-notes-containment-'))
  const workspace = join(root, 'workspace')
  const outside = join(root, 'outside')
  mkdirSync(workspace)
  mkdirSync(outside)
  try {
    symlinkSync(outside, join(workspace, '.ur'))
    expect(() => remember(workspace, 'must stay contained')).toThrow(
      'regular workspace directories',
    )
    expect(() => addResearch(workspace, 'notes', 'must stay contained')).toThrow(
      'regular workspace directories',
    )
    expect(() => listMemory(workspace)).toThrow(
      'regular workspace directories',
    )
    unlinkSync(join(workspace, '.ur'))
    remember(workspace, 'safe')
    expect(listMemory(workspace)).toHaveLength(1)
    addResearch(workspace, 'papers', 'safe paper')
    expect(listResearch(workspace, 'papers')).toHaveLength(1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('explicit remember can be promoted into recallable auto-memory', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'urn-memdir-'))
  const memoryDir = join(tmp, 'memory')
  try {
    const filePath = rememberInAutoMemory(memoryDir, 'Prefer bun test for this project')
    expect(filePath).toBeTruthy()
    expect(existsSync(join(memoryDir, 'MEMORY.md'))).toBe(true)
    expect(readFileSync(join(memoryDir, 'MEMORY.md'), 'utf-8')).toContain(
      'Prefer bun test',
    )
    const files = readdirSync(memoryDir).filter(file => file.endsWith('.md'))
    expect(files.length).toBeGreaterThanOrEqual(2)
    expect(readFileSync(filePath!, 'utf-8')).toContain('type: feedback')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
