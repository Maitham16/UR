import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { buildOrUpdateIndex, searchCode } from '../src/utils/codeIndex/indexer.js'
import { indexPath, loadIndex, saveIndex } from '../src/utils/codeIndex/store.js'
import { buildCodeGraph, loadGraph, whereDefined } from '../src/utils/codeIndex/graph.js'
import { buildRepoIndex, loadRepoIndex, loadSymbolIndex } from '../src/utils/codeIndex/repoIndex.js'
import { call } from '../src/commands/code-index/code-index.js'
import { runWithCwdOverride } from '../src/utils/cwd.js'

const dirs: string[] = []
function fixture(): string { const root = mkdtempSync(join(tmpdir(), 'ur-code-retrieval-')); dirs.push(root); return root }
function put(root: string, file: string, text: string): string { const path = join(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); return path }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const signal = () => new AbortController().signal

test('changed and deleted files are excluded at search and refresh restores current content', async () => {
  const root = fixture()
  const changed = put(root, 'changed.ts', 'export function retireToken() { return "outdated" }')
  const deleted = put(root, 'deleted.ts', 'export function retireCredential() { return "deleted" }')
  put(root, 'current.ts', 'export function retireSession() { return "current" }')
  await buildOrUpdateIndex({ root, signal: signal(), lexical: true })
  writeFileSync(changed, 'export function replaceToken() { return "fresh" }'); rmSync(deleted)
  const found = await searchCode({ root, query: 'retire', signal: signal(), lexical: true })
  expect(found.hits.map(hit => hit.file)).toEqual(['current.ts'])
  expect(found.diagnostics.staleFiles).toEqual(['changed.ts'])
  expect(found.diagnostics.missingFiles).toEqual(['deleted.ts'])
  expect(found.hits[0]!.sourceHash).toBe(found.index!.files['current.ts']!.hash)
  await buildOrUpdateIndex({ root, signal: signal(), lexical: true })
  const refreshed = await searchCode({ root, query: 'replaceToken', signal: signal(), lexical: true })
  expect(refreshed.hits[0]!.file).toBe('changed.ts')
  expect(refreshed.diagnostics.staleFiles).toEqual([])
})

test('structural ranking includes direct symbol and dependency context', async () => {
  const root = fixture()
  put(root, 'src/vault.ts', 'export function rotateCredential() { return 1 }')
  put(root, 'src/worker.ts', "import './vault.js'\nexport function execute() { return 2 }")
  put(root, 'src/unrelated.ts', 'export function renderButton() { return 3 }')
  await buildOrUpdateIndex({ root, signal: signal(), lexical: true })
  const { hits } = await searchCode({ root, query: 'rotateCredential', signal: signal(), lexical: true })
  expect(hits.map(hit => hit.file)).toEqual(['src/vault.ts', 'src/worker.ts'])
  expect(hits[0]!.reasons).toContain('symbol'); expect(hits[1]!.reasons).toContain('dependency')
  const scoped = await searchCode({ root, query: 'rotateCredential', path: 'src/worker.ts', k: 1, signal: signal(), lexical: true })
  expect(scoped.hits.map(hit => hit.file)).toEqual(['src/worker.ts'])
})

test('embedding outage is explicit while lexical code search remains useful', async () => {
  const root = fixture(); put(root, 'code.ts', 'export function retryNetwork() {}')
  const build = await buildOrUpdateIndex({ root, signal: signal(), embed: async () => { throw new Error('service offline') } })
  expect(build.stats.embedding).toEqual({ available: false, reason: 'service offline' })
  const found = await searchCode({ root, query: 'retry network', signal: signal() })
  expect(found.diagnostics.mode).toBe('lexical'); expect(found.diagnostics.embeddingReason).toBe('service offline')
  expect(found.hits).toHaveLength(1)
})

test('semantic query validates embedding dimensions, model identity and finite values', async () => {
  const root = fixture(); put(root, 'code.ts', 'export function retryNetwork() {}')
  await buildOrUpdateIndex({ root, signal: signal(), model: 'fixture', embed: async texts => texts.map(() => [1, 0]) })
  const match = await searchCode({ root, query: 'recover connection', signal: signal(), embed: async () => [[1, 0]] })
  expect(match.diagnostics.mode).toBe('hybrid'); expect(match.hits).toHaveLength(1)
  const mismatch = await searchCode({ root, query: 'retry', signal: signal(), embed: async () => [[1, 0, 0]] })
  expect(mismatch.diagnostics.mode).toBe('lexical'); expect(mismatch.diagnostics.embeddingReason).toContain('invalid')
  await expect(searchCode({ root, query: 'retry', signal: signal(), model: 'other' })).rejects.toThrow('rebuild')
})

test('coverage reports explicit file cap, oversized files and truncated chunk windows', async () => {
  const root = fixture()
  put(root, 'a.ts', 'export const a = 1')
  put(root, 'b.ts', 'export const b = 1')
  put(root, 'c.ts', 'x'.repeat(200_001))
  put(root, 'd.ts', 'x\n'.repeat(12_000))
  const capped = await buildOrUpdateIndex({ root, signal: signal(), lexical: true, maxFiles: 1 })
  expect(capped.stats.coverage.omittedByLimit).toBe(3)
  expect(capped.stats.coverage.complete).toBe(false)
  const full = await buildOrUpdateIndex({ root, signal: signal(), lexical: true })
  expect(full.stats.coverage.skipped.map(item => item.file)).toEqual(['c.ts'])
  expect(full.stats.coverage.truncatedFiles).toEqual(['d.ts'])
})

test('legacy vectors upgrade in place and unchanged embeddings are reused', async () => {
  const root = fixture(); put(root, 'a.ts', 'export function useful() {}')
  let calls = 0
  const embed = async (texts: string[]) => { calls++; return texts.map(() => [1, 0]) }
  const first = await buildOrUpdateIndex({ root, signal: signal(), model: 'fixture', embed })
  first.index.version = 1; delete first.index.coverage; delete first.index.files['a.ts']!.symbols
  await saveIndex(root, first.index)
  const upgraded = await buildOrUpdateIndex({ root, signal: signal(), model: 'fixture', embed })
  expect(upgraded.index.version).toBe(2); expect(upgraded.index.files['a.ts']!.symbols).toContain('useful')
  expect(calls).toBe(1)
})

test('graph and repo artifacts also exclude changed or missing source and stale dependent artifacts', async () => {
  const root = fixture(); const file = put(root, 'code.ts', 'export function beforeChange() {}')
  await buildCodeGraph({ root }); await buildRepoIndex({ root })
  expect(whereDefined(loadGraph(root)!, 'beforeChange')).toEqual(['code.ts'])
  expect(loadSymbolIndex(root)!.symbols.map(symbol => symbol.name)).toContain('beforeChange')
  writeFileSync(file, 'export function afterChange() {}')
  expect(loadGraph(root)!.staleFiles).toEqual(['code.ts'])
  expect(whereDefined(loadGraph(root)!, 'beforeChange')).toEqual([])
  expect(loadRepoIndex(root)!.files).toEqual([])
  expect(loadSymbolIndex(root)!.symbols).toEqual([])
  rmSync(file)
  expect(loadRepoIndex(root)!.staleFiles).toEqual(['code.ts'])
})

test('interrupted build does not replace a complete on-disk snapshot', async () => {
  const root = fixture(); put(root, 'a.ts', 'export const initial = 1')
  await buildOrUpdateIndex({ root, signal: signal(), lexical: true })
  const before = readFileSync(indexPath(root), 'utf8')
  put(root, 'a.ts', 'export const changed = 2')
  const controller = new AbortController()
  await expect(buildOrUpdateIndex({ root, signal: controller.signal, embed: async () => { controller.abort(); throw new Error('aborted') } })).rejects.toThrow()
  expect(readFileSync(indexPath(root), 'utf8')).toBe(before)
})

test('canonical command reports coverage and query freshness in JSON', async () => {
  const root = fixture(); const path = put(root, 'a.ts', 'export const current = 1')
  const build = await runWithCwdOverride(root, () => call('build --lexical --json', {} as never))
  if (build.type !== 'text') throw new Error('expected text')
  expect(JSON.parse(build.value).coverage.complete).toBe(true)
  rmSync(path)
  const search = await runWithCwdOverride(root, () => call('search current --json --lexical', {} as never))
  if (search.type !== 'text') throw new Error('expected text')
  expect(JSON.parse(search.value).diagnostics.missingFiles).toEqual(['a.ts'])
})

test('generated repository over the old 5000-file limit has full coverage and measured exact-symbol recall', async () => {
  const root = fixture()
  const count = 5201
  for (let i = 0; i < count; i++) put(root, `src/unit${String(i).padStart(5, '0')}.ts`, `export function capability${i}() { return ${i} }`)
  const started = performance.now()
  const build = await buildOrUpdateIndex({ root, signal: signal(), lexical: true })
  const buildMs = performance.now() - started
  expect(build.stats.coverage).toMatchObject({ candidates: count, indexed: count, omittedByLimit: 0, complete: true })
  let recalled = 0
  const latencies: number[] = []
  for (const i of [0, 500, 4999, 5000, 5200]) {
    const result = await searchCode({ root, query: `capability${i}`, signal: signal(), lexical: true, k: 1 })
    if (result.hits[0]?.file === `src/unit${String(i).padStart(5, '0')}.ts`) recalled++
    latencies.push(result.diagnostics.durationMs)
  }
  expect(recalled).toBe(5)
  expect((await loadIndex(root))?.coverage?.indexed).toBe(count)
  // Broad regression bound, not a machine-independent performance promise.
  expect(Math.max(...latencies)).toBeLessThan(15_000)
  console.info(JSON.stringify({ fixture: 'generated-5201-files', buildMs, searchMs: latencies, exactSymbolRecallAt1: recalled / 5, indexedFraction: 1 }))
}, 60_000)
