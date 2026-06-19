import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chunkText } from '../src/utils/codeIndex/chunker.ts'
import { cosineSimilarity, loadIndex, saveIndex, sha1 } from '../src/utils/codeIndex/store.ts'
import { isCodeIndexEnabled } from '../src/utils/codeIndex/index.ts'
import { isCodeIndexWatchable } from '../src/utils/codeIndex/watcher.ts'
import type { CodeIndex } from '../src/utils/codeIndex/types.ts'

test('cosineSimilarity: identical vectors = 1, orthogonal = 0', () => {
  expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6)
  expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6)
  // opposite direction
  expect(cosineSimilarity([1, 2, 3], [-1, -2, -3])).toBeCloseTo(-1, 6)
})

test('cosineSimilarity: guards against bad input', () => {
  expect(cosineSimilarity([], [])).toBe(0)
  expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0) // length mismatch
  expect(cosineSimilarity([0, 0], [1, 1])).toBe(0) // zero vector
})

test('chunkText: windows with overlap cover all lines', () => {
  const lines = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join('\n')
  const chunks = chunkText(lines, { maxLines: 10, overlap: 2 })
  expect(chunks.length).toBeGreaterThan(1)
  // first chunk starts at line 1
  expect(chunks[0]!.startLine).toBe(1)
  expect(chunks[0]!.endLine).toBe(10)
  // overlap: second chunk starts before previous chunk ends
  expect(chunks[1]!.startLine).toBeLessThan(chunks[0]!.endLine)
  // last chunk reaches the final line
  expect(chunks[chunks.length - 1]!.endLine).toBe(25)
})

test('chunkText: empty/whitespace input yields no chunks', () => {
  expect(chunkText('')).toEqual([])
  expect(chunkText('   \n\n  \n')).toEqual([])
})

test('chunkText: respects maxChunks cap', () => {
  const big = Array.from({ length: 1000 }, (_, i) => `x${i}`).join('\n')
  const chunks = chunkText(big, { maxLines: 5, overlap: 0, maxChunks: 7 })
  expect(chunks.length).toBe(7)
})

test('sha1 is stable and content-sensitive', () => {
  expect(sha1('abc')).toBe(sha1('abc'))
  expect(sha1('abc')).not.toBe(sha1('abd'))
})

test('save/load index round-trips', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'urci-'))
  const index: CodeIndex = {
    version: 1,
    model: 'test-model',
    dim: 3,
    root: tmp,
    builtAt: new Date().toISOString(),
    files: { 'a.ts': { hash: sha1('x'), chunkIds: ['a.ts#1-1'] } },
    chunks: {
      'a.ts#1-1': {
        id: 'a.ts#1-1',
        file: 'a.ts',
        startLine: 1,
        endLine: 1,
        text: 'x',
        vector: [0.1, 0.2, 0.3],
      },
    },
  }
  await saveIndex(tmp, index)
  const loaded = await loadIndex(tmp)
  expect(loaded?.model).toBe('test-model')
  expect(loaded?.chunks['a.ts#1-1']?.vector).toEqual([0.1, 0.2, 0.3])
  rmSync(tmp, { recursive: true, force: true })
})

test('loadIndex returns null for missing index', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'urci-'))
  expect(await loadIndex(tmp)).toBeNull()
  rmSync(tmp, { recursive: true, force: true })
})

test('isCodeIndexEnabled honors the env flag', () => {
  expect(isCodeIndexEnabled({})).toBe(false)
  expect(isCodeIndexEnabled({ UR_CODE_INDEX: '' })).toBe(false)
  expect(isCodeIndexEnabled({ UR_CODE_INDEX: '0' })).toBe(false)
  expect(isCodeIndexEnabled({ UR_CODE_INDEX: 'off' })).toBe(false)
  expect(isCodeIndexEnabled({ UR_CODE_INDEX: '1' })).toBe(true)
  expect(isCodeIndexEnabled({ UR_CODE_INDEX: 'true' })).toBe(true)
})

test('code-index watcher filters source files and ignored trees', () => {
  const root = '/repo'
  expect(isCodeIndexWatchable(root, '/repo/src/index.ts')).toBe(true)
  expect(isCodeIndexWatchable(root, '/repo/docs/notes.md')).toBe(true)
  expect(isCodeIndexWatchable(root, '/repo/node_modules/pkg/index.ts')).toBe(false)
  expect(isCodeIndexWatchable(root, '/repo/.ur/index/index.json')).toBe(false)
  expect(isCodeIndexWatchable(root, '/repo/dist/bundle.js')).toBe(false)
  expect(isCodeIndexWatchable(root, '/repo/src/app.min.js')).toBe(false)
  expect(isCodeIndexWatchable(root, '/repo/bun.lock')).toBe(false)
})
