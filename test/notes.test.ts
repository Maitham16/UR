import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { forget, listMemory, remember } from '../src/ur/notes.ts'

test('memory remember/forget', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'urn-'))
  remember(tmp, 'use bun')
  remember(tmp, 'prefer tabs')
  expect(listMemory(tmp).length).toBe(2)
  expect(forget(tmp, 'tabs')).toBe(1)
  expect(listMemory(tmp).length).toBe(1)
  rmSync(tmp, { recursive: true, force: true })
})
