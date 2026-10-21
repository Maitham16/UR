import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { buildMemoryIndex, loadMemoryIndex, memoryDigest, searchMemoryIndex, semanticMemoryIndexPath } from '../src/memdir/retrieval.js'
import { findRelevantMemories } from '../src/memdir/findRelevantMemories.js'
import { retrievalTerms } from '../src/utils/retrieval.js'
import { runWithCwdOverride } from '../src/utils/cwd.js'
import { call } from '../src/commands/semantic-memory/semantic-memory.js'

const dirs: string[] = []
function fixture(): string { const root = mkdtempSync(join(tmpdir(), 'ur-memory-retrieval-')); dirs.push(root); return root }
function put(root: string, file: string, text: string): string { const path = join(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); return path }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const signal = () => new AbortController().signal
const unavailable = async (): Promise<number[][]> => { throw new Error('Embedding model not installed') }

test('Unicode terms preserve Arabic, Chinese, accents and camelCase identifiers', () => {
  const terms = retrievalTerms('تدوير الرموز 更新令牌 café refreshToken')
  expect(terms).toContain('تدوير'); expect(terms).toContain('更新'); expect(terms).toContain('café'); expect(terms).toContain('refresh'); expect(terms).toContain('token')
})

test('memory body retrieval measures multilingual recall and excludes unrelated lexical facts', async () => {
  const root = fixture()
  const cases = [
    ['one.md', 'The deployment credential rotation uses a ten minute overlap.', 'credential rotation'],
    ['two.md', 'يجب تدوير الرموز السرية كل أسبوع.', 'تدوير الرموز'],
    ['three.md', '更新令牌之前必须保留旧令牌。', '更新令牌'],
    ['four.md', 'Le café conserve les paramètres régionaux.', 'café paramètres'],
  ]
  for (const [file, text] of cases) put(root, `.ur/memory/${file}`, `---\ndescription: miscellaneous\n---\n${text}`)
  const index = await buildMemoryIndex({ root, lexical: true })
  let recalled = 0
  for (const [file, , query] of cases) {
    const { results } = await searchMemoryIndex(index, query!, { lexical: true })
    if (results[0]?.source.endsWith(file!)) recalled++
  }
  expect(recalled / cases.length).toBe(1)
  expect((await searchMemoryIndex(index, 'volcanic basalt geology', { lexical: true })).results).toEqual([])
})

test('hybrid search retrieves paraphrases through actual supplied embedding vectors and reuses unchanged vectors', async () => {
  const root = fixture()
  put(root, '.ur/memory/auth.md', 'Credentials remain usable briefly while their replacements propagate.')
  put(root, '.ur/memory/other.md', 'The preferred theme is purple.')
  let embedded = 0
  const embed = async (texts: string[]) => { embedded += texts.length; return texts.map(text => text.includes('purple') ? [0, 1] : [1, 0]) }
  const index = await buildMemoryIndex({ root, model: 'fixture-embedding', embed })
  expect(index.mode).toBe('hybrid')
  expect(embedded).toBe(2)
  const refreshed = await buildMemoryIndex({ root, model: 'fixture-embedding', embed })
  expect(embedded).toBe(2)
  const result = await searchMemoryIndex(refreshed, 'How do we rotate tokens?', { embed })
  expect(result.results).toHaveLength(1)
  expect(result.results[0]!.source).toEndWith('auth.md')
  expect(result.results[0]!.lexicalScore).toBe(0)
  expect(result.results[0]!.semanticScore).toBe(1)
})

test('unavailable or malformed embeddings explicitly preserve lexical retrieval', async () => {
  const root = fixture(); put(root, 'README.md', 'Authentication requires a rotating token.')
  const index = await buildMemoryIndex({ root, embed: unavailable })
  expect(index.mode).toBe('lexical'); expect(index.embeddingReason).toContain('not installed')
  expect((await searchMemoryIndex(index, 'rotating token')).results).toHaveLength(1)
  const invalid = await buildMemoryIndex({ root, embed: async () => [[Number.NaN]] })
  expect(invalid.embeddingReason).toContain('invalid')
})

test('refresh removes deleted and changed body text, including the persisted copy', async () => {
  const root = fixture(); const path = put(root, '.ur/memory/secret.md', 'Retired key is ZEBRA999.')
  await buildMemoryIndex({ root, lexical: true })
  writeFileSync(path, 'Current key comes from the vault.')
  let index = await buildMemoryIndex({ root, lexical: true })
  expect((await searchMemoryIndex(index, 'ZEBRA999', { lexical: true })).results).toEqual([])
  rmSync(path)
  index = await buildMemoryIndex({ root, lexical: true })
  expect(index.entries).toEqual([])
  expect(readFileSync(semanticMemoryIndexPath(root), 'utf8')).not.toContain('ZEBRA999')
})

test('explicit supersession, expiry, deletion and changed provenance anchors exclude stale facts', async () => {
  const root = fixture(); const code = put(root, 'src/auth.ts', 'export const rotation = 1')
  const anchor = memoryDigest(readFileSync(code, 'utf8'))
  put(root, '.ur/memory/old.md', '---\nid: policy-old\n---\nRotate every year.')
  put(root, '.ur/memory/new.md', '---\nid: policy-new\nsupersedes: policy-old\n---\nRotate every week.')
  put(root, '.ur/memory/expired.md', '---\nvalid-until: "2000-01-01"\n---\nRotate every hour.')
  put(root, '.ur/memory/deleted.md', '---\nstatus: deleted\n---\nRotate every minute.')
  put(root, '.ur/memory/verified.md', `---\nanchors:\n  - path: src/auth.ts\n    sha256: ${anchor}\n---\nRotation behavior verified.`)
  let index = await buildMemoryIndex({ root, lexical: true })
  expect(index.entries).toHaveLength(2)
  writeFileSync(code, 'export const rotation = 2')
  index = await buildMemoryIndex({ root, lexical: true })
  expect(index.entries).toHaveLength(1)
  expect(index.entries[0]!.text).toContain('every week')
  expect(index.sources.find(source => source.source.endsWith('verified.md'))?.status).toBe('stale')
})

test('competing facts remain visible with conflict provenance rather than arbitrarily choosing newest', async () => {
  const root = fixture()
  put(root, '.ur/memory/a.md', '---\nconflict-key: runtime\n---\nProduction runtime is Node.')
  put(root, '.ur/memory/b.md', '---\nconflict-key: runtime\n---\nProduction runtime is Bun.')
  const index = await buildMemoryIndex({ root, lexical: true })
  const result = await searchMemoryIndex(index, 'production runtime', { lexical: true })
  expect(result.results).toHaveLength(2)
  expect(result.results.every(entry => entry.conflicts.length === 1)).toBe(true)
})

test('legacy index is rebuilt at the canonical command and source-path IDs avoid basename collisions', async () => {
  const root = fixture()
  put(root, '.ur/memory/a/note.md', 'First unique fact.')
  put(root, '.ur/memory/b/note.md', 'Second unique fact.')
  put(root, '.ur/semantic-memory/index/index.json', JSON.stringify({ version: 1, entries: [{ text: 'stale old fact' }] }))
  expect(await loadMemoryIndex(root)).toBeNull()
  const result = await runWithCwdOverride(root, () => call('search unique --json --lexical', {} as never))
  if (result.type !== 'text') throw new Error('expected text')
  const data = JSON.parse(result.value)
  expect(data.results).toHaveLength(2)
  expect(new Set(data.results.map((entry: { id: string }) => entry.id)).size).toBe(2)
  expect((await loadMemoryIndex(root))?.version).toBe(2)
})

test('auto recall presents body-only facts to the model and does not revive already surfaced superseding facts', async () => {
  const root = fixture(); const dir = join(root, '.ur/memory')
  const old = put(root, '.ur/memory/old.md', '---\nid: old\ndescription: miscellaneous\n---\nCredential rotation occurs yearly.')
  const current = put(root, '.ur/memory/current.md', '---\nsupersedes: old\ndescription: miscellaneous\n---\nCredential rotation occurs weekly.')
  const chosen = await runWithCwdOverride(root, () => findRelevantMemories('credential rotation', dir, signal(), [], new Set(), {
    select: async (_query, candidates, _signal, _tools, excerpts) => {
      expect(candidates.some(candidate => candidate.filePath === old)).toBe(false)
      expect(excerpts.get(current)).toContain('weekly')
      return ['current.md', 'invented.md']
    },
  }))
  expect(chosen.map(memory => memory.path)).toEqual([current])
  const suppressed = await runWithCwdOverride(root, () => findRelevantMemories('credential rotation', dir, signal(), [], new Set([current]), {
    select: async () => { throw new Error('No active fresh candidates should reach selector') },
  }))
  expect(suppressed).toEqual([])
})

test('auto recall discards memory changed while the model selected it', async () => {
  const root = fixture(); const path = put(root, '.ur/memory/fact.md', 'Deployment uses blue green rotation.')
  const result = await runWithCwdOverride(root, () => findRelevantMemories('deployment', dirname(path), signal(), [], new Set(), {
    select: async () => { writeFileSync(path, 'Replaced during selection.'); return ['fact.md'] },
  }))
  expect(result).toEqual([])
})

test('aborted indexing preserves the previous complete snapshot', async () => {
  const root = fixture(); put(root, 'README.md', 'Current memory body.')
  await buildMemoryIndex({ root, lexical: true })
  const before = readFileSync(semanticMemoryIndexPath(root), 'utf8')
  const controller = new AbortController(); controller.abort()
  await expect(buildMemoryIndex({ root, signal: controller.signal, lexical: true })).rejects.toThrow()
  expect(readFileSync(semanticMemoryIndexPath(root), 'utf8')).toBe(before)
})

test('search validates an old in-memory index rather than replaying deleted or anchor-invalid facts', async () => {
  const root = fixture(); const source = put(root, 'src/engine.ts', 'old source')
  const memory = put(root, '.ur/memory/proof.md', `---\nanchors:\n  - path: src/engine.ts\n    sha256: ${memoryDigest('old source')}\n---\nEngine tests passed.`)
  const index = await buildMemoryIndex({ root, lexical: true })
  writeFileSync(source, 'new source')
  const invalid = await searchMemoryIndex(index, 'engine tests', { lexical: true })
  expect(invalid.results).toEqual([])
  expect(invalid.staleSources).toEqual([memory])
  rmSync(memory)
  expect((await searchMemoryIndex(index, 'engine tests', { lexical: true })).results).toEqual([])
})

test('main-model memory attachment carries deep body excerpt and rechecks selection digest', async () => {
  const { readMemoriesForSurfacing } = await import('../src/utils/attachments.js')
  const root = fixture()
  const body = Array.from({ length: 300 }, (_, i) => `Opening reference ${i}`).join('\n') + '\nDeployment credential rotation requires overlap.'
  const path = put(root, '.ur/memory/deep.md', body)
  const selection = { path, mtimeMs: Date.now(), sourceDigest: memoryDigest(body), excerpt: 'Deployment credential rotation requires overlap.' }
  const attachments = await runWithCwdOverride(root, () => readMemoriesForSurfacing([selection]))
  expect(attachments).toHaveLength(1)
  expect(attachments[0]!.content).toContain(selection.excerpt)
  writeFileSync(path, 'Changed after selection.')
  expect(await runWithCwdOverride(root, () => readMemoriesForSurfacing([selection]))).toEqual([])
})
