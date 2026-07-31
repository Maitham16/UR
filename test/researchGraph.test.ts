import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
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
