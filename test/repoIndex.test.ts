import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { call as codeIndexCall } from '../src/commands/code-index/code-index.ts'
import type { LocalCommandResult } from '../src/types/command.js'

function textValue(r: LocalCommandResult): string {
  if (r.type !== 'text') throw new Error('expected text result')
  return r.value
}
import { runWithCwdOverride } from '../src/utils/cwd.ts'
import {
  buildRepoIndex,
  findCallers,
  findTestsForFile,
  loadCallIndex,
  loadConfigIndex,
  loadDocIndex,
  loadRepoIndex,
  loadSymbolIndex,
  loadTestIndex,
  repoSearch,
  symbolSearch,
} from '../src/utils/codeIndex/repoIndex.ts'

function fixture(root: string, relPath: string, content: string): void {
  const abs = join(root, relPath)
  mkdirSync(abs.split('/').slice(0, -1).join('/'), { recursive: true })
  writeFileSync(abs, content)
}

test('buildRepoIndex classifies files into source/test/doc/config', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-repo-idx-'))
  fixture(tmp, 'src/add.ts', 'export function add(a: number, b: number) { return a + b }')
  fixture(tmp, 'src/add.test.ts', 'import { test, expect } from "bun:test"\ntest("adds", () => expect(add(1,2)).toBe(3))')
  fixture(tmp, 'README.md', '# Project\n')
  fixture(tmp, 'package.json', '{"name": "demo", "scripts": {"test": "bun test"}}')

  const { repo } = await buildRepoIndex({ root: tmp })
  expect(repo.files.length).toBeGreaterThanOrEqual(4)
  expect(repo.files.find(f => f.path === 'src/add.ts')?.kind).toBe('source')
  expect(repo.files.find(f => f.path === 'src/add.test.ts')?.kind).toBe('test')
  expect(repo.files.find(f => f.path === 'README.md')?.kind).toBe('doc')
  expect(repo.files.find(f => f.path === 'package.json')?.kind).toBe('config')
  rmSync(tmp, { recursive: true, force: true })
})

test('buildRepoIndex extracts symbols and calls', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-repo-idx-'))
  fixture(
    tmp,
    'src/util.ts',
    'export function helper() { return 1 }\nexport class Helper {}',
  )
  fixture(tmp, 'src/main.ts', "import { helper } from './util.js'\nexport function main() { helper() }")

  const { repo, symbols, calls } = await buildRepoIndex({ root: tmp })
  const symbolNames = symbols.symbols.map(s => s.name)
  expect(symbolNames).toContain('helper')
  expect(symbolNames).toContain('Helper')
  expect(symbolNames).toContain('main')

  // Cross-file call extraction is not performed by the dependency-free regex pass;
  // callers are recorded only when the callee is defined in the same file.
  expect(findCallers(calls, 'helper').some(c => c.callee === 'helper')).toBe(true)

  const mainFile = repo.files.find(f => f.path === 'src/main.ts')
  expect(mainFile?.imports).toContain('src/util.ts')
  const utilFile = repo.files.find(f => f.path === 'src/util.ts')
  expect(utilFile?.importedBy).toContain('src/main.ts')
  rmSync(tmp, { recursive: true, force: true })
})

test('buildRepoIndex maps tests and docs', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-repo-idx-'))
  fixture(tmp, 'src/greet.ts', 'export function greet() { return "hi" }')
  fixture(tmp, 'src/greet.test.ts', 'test("greets", () => expect(greet()).toBe("hi"))')
  fixture(tmp, 'docs/guide.md', '# Guide\nSee [README](../README.md)\n')
  fixture(tmp, 'README.md', '# Project\n')

  const { tests, docs } = await buildRepoIndex({ root: tmp })
  expect(tests.tests.some(t => t.file === 'src/greet.test.ts' && t.name === 'greets')).toBe(true)
  expect(docs.docs.some(d => d.path === 'docs/guide.md' && d.title === 'Guide')).toBe(true)
  const guide = docs.docs.find(d => d.path === 'docs/guide.md')
  expect(guide?.refs).toContain('../README.md')
  rmSync(tmp, { recursive: true, force: true })
})

test('buildRepoIndex extracts config keys', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-repo-idx-'))
  fixture(tmp, 'package.json', '{"name": "demo", "dependencies": {}}')
  fixture(tmp, 'tsconfig.json', '{"compilerOptions": {}}')

  const { configs } = await buildRepoIndex({ root: tmp })
  const pkg = configs.configs.find(c => c.path === 'package.json')
  expect(pkg?.kind).toBe('package')
  expect(pkg?.keys).toContain('name')
  const ts = configs.configs.find(c => c.path === 'tsconfig.json')
  expect(ts?.kind).toBe('typescript')
  expect(ts?.keys).toContain('compilerOptions')
  rmSync(tmp, { recursive: true, force: true })
})

test('repo index round-trips via load functions', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-repo-idx-'))
  fixture(tmp, 'src/x.ts', 'export function x() {}')

  await buildRepoIndex({ root: tmp })
  const repo = loadRepoIndex(tmp)
  const symbols = loadSymbolIndex(tmp)
  const calls = loadCallIndex(tmp)
  const tests = loadTestIndex(tmp)
  const docs = loadDocIndex(tmp)
  const configs = loadConfigIndex(tmp)

  expect(repo?.files.length).toBeGreaterThanOrEqual(1)
  expect(symbols?.symbols.length).toBeGreaterThanOrEqual(1)
  expect(calls?.calls.length).toBeGreaterThanOrEqual(0)
  expect(tests?.tests.length).toBeGreaterThanOrEqual(0)
  expect(docs?.docs.length).toBeGreaterThanOrEqual(0)
  expect(configs?.configs.length).toBeGreaterThanOrEqual(0)
  rmSync(tmp, { recursive: true, force: true })
})

test('repoSearch and symbolSearch find by query', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-repo-idx-'))
  fixture(tmp, 'src/searchable.ts', 'export function findMe() {}')

  const { repo, symbols } = await buildRepoIndex({ root: tmp })
  expect(repoSearch(repo, 'searchable').some(f => f.path === 'src/searchable.ts')).toBe(true)
  expect(symbolSearch(symbols, 'findMe').some(s => s.name === 'findMe')).toBe(true)
  rmSync(tmp, { recursive: true, force: true })
})

test('findTestsForFile maps tests to source files', async () => {
  const tests = {
    version: 1 as const,
    builtAt: new Date().toISOString(),
    tests: [
      { file: 'src/greet.test.ts', name: 'greets', kind: 'test' },
      { file: 'src/other.test.ts', name: 'other', kind: 'test' },
    ],
  }
  expect(findTestsForFile(tests, 'src/greet.ts').length).toBe(1)
  expect(findTestsForFile(tests, 'src/missing.ts').length).toBe(0)
})

test('code-index repo CLI builds and queries semantic repo artifacts', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-repo-cli-'))
  fixture(tmp, 'src/greet.ts', 'export function greet() { return "hi" }\ngreet()\n')
  fixture(tmp, 'src/greet.test.ts', 'test("greets", () => expect(greet()).toBe("hi"))')
  fixture(tmp, 'docs/guide.md', '# Guide\nUse greet.\n')
  fixture(tmp, 'package.json', '{"name": "demo", "scripts": {"test": "bun test"}}')

  const build = await runWithCwdOverride(tmp, () =>
    codeIndexCall('repo build --json', {} as never),
  )
  expect(build.type).toBe('text')
  expect(JSON.parse(textValue(build)).files).toBeGreaterThanOrEqual(4)

  const symbols = await runWithCwdOverride(tmp, () =>
    codeIndexCall('repo symbols greet --json', {} as never),
  )
  expect(JSON.parse(textValue(symbols)).hits.some((h: { name: string }) => h.name === 'greet')).toBe(true)

  const callers = await runWithCwdOverride(tmp, () =>
    codeIndexCall('repo callers greet --json', {} as never),
  )
  expect(JSON.parse(textValue(callers)).hits.some((h: { callee: string }) => h.callee === 'greet')).toBe(true)

  const tests = await runWithCwdOverride(tmp, () =>
    codeIndexCall('repo tests src/greet.ts --json', {} as never),
  )
  expect(JSON.parse(textValue(tests)).hits.some((h: { file: string }) => h.file === 'src/greet.test.ts')).toBe(true)

  const docs = await runWithCwdOverride(tmp, () =>
    codeIndexCall('repo docs guide --json', {} as never),
  )
  expect(JSON.parse(textValue(docs)).hits.some((h: { path: string }) => h.path === 'docs/guide.md')).toBe(true)

  const configs = await runWithCwdOverride(tmp, () =>
    codeIndexCall('repo configs package --json', {} as never),
  )
  expect(JSON.parse(textValue(configs)).hits.some((h: { path: string }) => h.path === 'package.json')).toBe(true)

  rmSync(tmp, { recursive: true, force: true })
})
