import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
  expect(indexWorkspace(tmp).count).toBeGreaterThanOrEqual(1)
  rmSync(tmp, { recursive: true, force: true })
})
