import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectProjectDna } from '../src/ur/projectDna.ts'

test('detects Node/TS project DNA', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'urd-'))
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ scripts: { build: 'x', test: 'y', start: 'z' } }))
  writeFileSync(join(tmp, 'package-lock.json'), '{}')
  writeFileSync(join(tmp, 'README.md'), '# x')
  mkdirSync(join(tmp, 'src'))
  const d = detectProjectDna(tmp)
  expect(d.languages).toContain('JavaScript/TypeScript')
  expect(d.packageManagers).toContain('npm')
  expect(d.runCommands.length).toBeGreaterThan(0)
  expect(d.readme).toBe('README.md')
  expect(d.importantFolders).toContain('src')
  rmSync(tmp, { recursive: true, force: true })
})
