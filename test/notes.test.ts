import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { forget, listMemory, remember, rememberInAutoMemory } from '../src/ur/notes.ts'

test('memory remember/forget', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'urn-'))
  remember(tmp, 'use bun')
  remember(tmp, 'prefer tabs')
  expect(listMemory(tmp).length).toBe(2)
  expect(forget(tmp, 'tabs')).toBe(1)
  expect(listMemory(tmp).length).toBe(1)
  rmSync(tmp, { recursive: true, force: true })
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
