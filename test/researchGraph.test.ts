import { expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addEntity, ENTITIES, graphSummary, isEntity, listEntity } from '../src/ur/researchGraph.ts'

test('research graph entities', () => {
  expect(ENTITIES.length).toBe(13)
  expect(isEntity('papers')).toBe(true)
  expect(isEntity('nope')).toBe(false)
  const tmp = mkdtempSync(join(tmpdir(), 'urg-'))
  addEntity(tmp, 'papers', 'p1')
  expect(listEntity(tmp, 'papers').length).toBe(1)
  expect(graphSummary(tmp).papers).toBe(1)
  rmSync(tmp, { recursive: true, force: true })
})

test('research graph rejects storage that escapes through a symlink', () => {
  const root = mkdtempSync(join(tmpdir(), 'urg-containment-'))
  const workspace = join(root, 'workspace')
  const outside = join(root, 'outside')
  mkdirSync(workspace)
  mkdirSync(outside)
  try {
    symlinkSync(outside, join(workspace, '.ur'))
    expect(() => addEntity(workspace, 'papers', 'unsafe')).toThrow(
      'regular workspace directories',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('research graph rejects a symlinked collection on reads and writes', () => {
  const root = mkdtempSync(join(tmpdir(), 'urg-collection-link-'))
  const workspace = join(root, 'workspace')
  const outside = join(root, 'outside.jsonl')
  mkdirSync(workspace)
  writeFileSync(outside, '{"ts":"unsafe","text":"outside"}\n')
  try {
    addEntity(workspace, 'papers', 'inside')
    const collection = join(workspace, '.ur', 'graph', 'papers.jsonl')
    unlinkSync(collection)
    symlinkSync(outside, collection)
    expect(() => listEntity(workspace, 'papers')).toThrow(
      'regular file',
    )
    expect(() => addEntity(workspace, 'papers', 'unsafe')).toThrow(
      'regular file',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
