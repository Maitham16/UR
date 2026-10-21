import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { parseFrontmatter } from '../utils/frontmatterParser.js'
import { embedTexts, getEmbeddingModel } from '../utils/codeIndex/embeddings.js'
import { cosineSimilarity } from '../utils/codeIndex/store.js'
import { lexicalScores, mapConcurrent, validateEmbeddings, validEmbedding, type EmbeddingFunction } from '../utils/retrieval.js'
import { writeFile } from 'node:fs/promises'

export type MemoryDocument = {
  id: string
  source: string
  text: string
  description: string
  digest: string
  mtimeMs: number
  bodyStartLine: number
  status: 'active' | 'expired' | 'deleted' | 'superseded' | 'stale'
  reason?: string
  supersedes: string[]
  conflictKey?: string
  conflicts: string[]
}

export type MemoryEntry = {
  id: string
  documentId: string
  source: string
  text: string
  startLine: number
  endLine: number
  sourceDigest: string
  conflicts: string[]
  vector?: number[]
}

export type MemoryIndex = {
  version: 2
  root: string
  builtAt: string
  model: string
  mode: 'hybrid' | 'lexical'
  embeddingReason?: string
  sources: Array<Omit<MemoryDocument, 'text' | 'description'>>
  entries: MemoryEntry[]
  unreadable: Array<{ source: string; reason: string }>
}

export const memoryDigest = (text: string): string => createHash('sha256').update(text).digest('hex')
const strings = (value: unknown): string[] => typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

/** Read current memory and validate explicit evidence anchors against source state. */
export async function readMemoryDocument(source: string, root: string, now = Date.now()): Promise<MemoryDocument> {
  const raw = await readFile(source, 'utf8')
  const info = await stat(source)
  const { frontmatter, content } = parseFrontmatter(raw, source)
  const id = typeof frontmatter.id === 'string' ? frontmatter.id : relative(root, source).replaceAll('\\', '/')
  const document: MemoryDocument = {
    id, source, text: content, description: typeof frontmatter.description === 'string' ? frontmatter.description : '',
    digest: memoryDigest(raw), mtimeMs: info.mtimeMs,
    bodyStartLine: raw.slice(0, raw.length - content.length).split('\n').length,
    status: frontmatter.status === 'deleted' || frontmatter.status === 'superseded' ? frontmatter.status : 'active',
    supersedes: strings(frontmatter.supersedes), conflicts: [],
    ...(typeof frontmatter['conflict-key'] === 'string' ? { conflictKey: frontmatter['conflict-key'] } : {}),
  }
  const expiration = frontmatter['valid-until'] ?? frontmatter.expires
  if (expiration !== undefined) {
    const date = expiration instanceof Date ? expiration.getTime() : Date.parse(String(expiration))
    if (!Number.isFinite(date) || date <= now) {
      document.status = 'expired'
      document.reason = Number.isFinite(date) ? 'Explicit validity period expired' : 'Invalid validity date'
    }
  }
  if (Array.isArray(frontmatter.anchors)) {
    for (const anchor of frontmatter.anchors) {
      if (!anchor || typeof anchor !== 'object' || typeof anchor.path !== 'string' || typeof anchor.sha256 !== 'string') {
        document.status = 'stale'
        document.reason = 'Invalid provenance anchor; expected path and sha256'
        break
      }
      const path = resolve(root, anchor.path)
      if (isAbsolute(anchor.path) || relative(root, path).startsWith('..')) {
        document.status = 'stale'; document.reason = 'Provenance anchor escapes project'; break
      }
      try {
        if (memoryDigest(await readFile(path, 'utf8')) !== anchor.sha256) {
          document.status = 'stale'; document.reason = `Source changed: ${anchor.path}`; break
        }
      } catch {
        document.status = 'stale'; document.reason = `Source unavailable: ${anchor.path}`; break
      }
    }
  }
  return document
}

/** Only explicit supersession resolves competing facts; the model judges meaning. */
export function reconcileMemoryDocuments(documents: MemoryDocument[]): MemoryDocument[] {
  const superseded = new Set(documents.filter(doc => doc.status === 'active').flatMap(doc => doc.supersedes))
  for (const doc of documents) {
    if (superseded.has(doc.id) && doc.status === 'active') { doc.status = 'superseded'; doc.reason = 'Replaced by an explicit supersedes reference' }
  }
  const groups = new Map<string, MemoryDocument[]>()
  for (const doc of documents) {
    if (doc.status !== 'active') continue
    // Duplicate identifiers are ambiguous too; never choose one by file order.
    for (const key of [`id:${doc.id}`, ...(doc.conflictKey ? [`fact:${doc.conflictKey}`] : [])]) {
      const group = groups.get(key) ?? []; group.push(doc); groups.set(key, group)
    }
  }
  for (const group of groups.values()) {
    if (new Set(group.map(doc => doc.text.trim())).size < 2) continue
    for (const doc of group) doc.conflicts = [...new Set([...doc.conflicts, ...group.filter(other => other !== doc).map(other => other.source)])]
  }
  return documents
}

/** Preserve every body line with bounded chunks; no silent paragraph cap. */
export function memoryEntries(documents: MemoryDocument[]): MemoryEntry[] {
  return documents.filter(doc => doc.status === 'active').flatMap(doc => {
    const entries: MemoryEntry[] = []
    const lines = doc.text.split('\n')
    let start = 0
    let accumulated = ''
    const flush = (end: number) => {
      if (accumulated.trim()) entries.push({
        id: `${doc.id}:${start + 1}:${end + 1}`, documentId: doc.id, source: doc.source,
        text: accumulated.trim(), startLine: start + doc.bodyStartLine, endLine: end + doc.bodyStartLine,
        sourceDigest: doc.digest, conflicts: doc.conflicts,
      })
      accumulated = ''
      start = end + 1
    }
    for (let i = 0; i < lines.length; i++) {
      if (accumulated && accumulated.length + lines[i]!.length > 2400) flush(i - 1)
      accumulated += `${lines[i]}\n`
      if (!lines[i]!.trim() && accumulated.length >= 800) flush(i)
    }
    flush(lines.length - 1)
    return entries
  })
}

export async function listSemanticMemorySources(root: string): Promise<string[]> {
  const sources: string[] = []
  for (const name of ['UR.md', 'README.md']) {
    const file = join(root, name)
    try { if ((await stat(file)).isFile()) sources.push(file) } catch { /* optional source */ }
  }
  const walk = async (dir: string): Promise<void> => {
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'quarantine') continue
      const file = join(dir, entry.name)
      if (entry.isDirectory()) await walk(file)
      else if (entry.isFile() && /\.(md|txt|jsonl)$/i.test(entry.name)) sources.push(file)
    }
  }
  await walk(join(root, '.ur', 'memory'))
  await walk(join(root, '.ur', 'docs'))
  return sources.sort()
}

export function semanticMemoryIndexPath(root: string): string {
  return join(root, '.ur', 'semantic-memory', 'index', 'index.json')
}

export async function loadMemoryIndex(root: string): Promise<MemoryIndex | null> {
  try {
    const value = JSON.parse(await readFile(semanticMemoryIndexPath(root), 'utf8')) as MemoryIndex
    // The old lexical format has no hashes/provenance: rebuild from sources.
    if (value.version !== 2 || !Array.isArray(value.entries) || !Array.isArray(value.sources) || typeof value.model !== 'string') return null
    if (value.entries.some(entry => !entry || typeof entry.id !== 'string' || typeof entry.text !== 'string' || typeof entry.sourceDigest !== 'string')) return null
    return { ...value, root }
  } catch { return null }
}

export type MemoryBuildOptions = {
  root: string
  signal?: AbortSignal
  model?: string
  lexical?: boolean
  embed?: EmbeddingFunction
  sources?: string[]
  persist?: boolean
  previous?: MemoryIndex | null
}

export async function buildMemoryIndex(options: MemoryBuildOptions): Promise<MemoryIndex> {
  const root = resolve(options.root)
  const previous = options.previous === undefined ? await loadMemoryIndex(root) : options.previous
  const model = options.model ?? process.env.UR_MEMORY_EMBED_MODEL?.trim() ?? getEmbeddingModel()
  const unreadable: MemoryIndex['unreadable'] = []
  const sources = options.sources ?? await listSemanticMemorySources(root)
  const documents = reconcileMemoryDocuments((await mapConcurrent(sources, async source => {
    options.signal?.throwIfAborted()
    try { return await readMemoryDocument(source, root) } catch (error) {
      unreadable.push({ source, reason: error instanceof Error ? error.message : String(error) }); return null
    }
  })).filter((doc): doc is MemoryDocument => doc !== null))
  const entries = memoryEntries(documents)
  const prior = new Map(previous?.model === model ? previous.entries.map(entry => [`${entry.source}:${entry.id}`, entry]) : [])
  const pending: MemoryEntry[] = []
  for (const entry of entries) {
    const old = prior.get(`${entry.source}:${entry.id}`)
    if (!options.lexical && old?.sourceDigest === entry.sourceDigest && old.text === entry.text && validEmbedding(old.vector)) entry.vector = old.vector
    else pending.push(entry)
  }
  let mode: MemoryIndex['mode'] = options.lexical ? 'lexical' : 'hybrid'
  let embeddingReason = options.lexical ? 'Lexical mode explicitly requested; semantic paraphrase recall unavailable' : undefined
  let dimension = entries.find(entry => entry.vector)?.vector?.length
  if (!options.lexical) for (let i = 0; i < pending.length; i += 32) {
    options.signal?.throwIfAborted()
    const batch = pending.slice(i, i + 32)
    try {
      const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(10_000)])
      const vectors = await (options.embed ?? embedTexts)(batch.map(entry => entry.text), { model, signal })
      validateEmbeddings(vectors, batch.length, dimension)
      dimension = vectors[0]!.length
      batch.forEach((entry, j) => { entry.vector = vectors[j]! })
    } catch (error) {
      options.signal?.throwIfAborted()
      mode = 'lexical'; embeddingReason = error instanceof Error ? error.message : String(error); break
    }
  }
  if (!entries.length) { mode = 'lexical'; embeddingReason = 'No active memory entries to embed' }
  const index: MemoryIndex = {
    version: 2, root, builtAt: new Date().toISOString(), model, mode, embeddingReason,
    sources: documents.map(({ text: _text, description: _description, ...doc }) => doc), entries, unreadable,
  }
  if (options.persist !== false) {
    options.signal?.throwIfAborted()
    const path = semanticMemoryIndexPath(root)
    await mkdir(join(root, '.ur', 'semantic-memory', 'index'), { recursive: true })
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(index), { mode: 0o600, flag: 'wx' })
      await rename(temporary, path)
    } finally { await rm(temporary, { force: true }) }
  }
  return index
}

export type MemorySearchResult = MemoryEntry & { score: number; lexicalScore: number; semanticScore: number }

/** Validate cached evidence even when a caller supplies an older index object. */
export async function searchMemoryIndex(index: MemoryIndex, query: string, options: {
  signal?: AbortSignal; embed?: EmbeddingFunction; limit?: number; lexical?: boolean; minimumSemanticScore?: number
} = {}): Promise<{ results: MemorySearchResult[]; mode: 'hybrid' | 'lexical'; embeddingReason?: string; staleSources: string[] }> {
  const liveDocuments = reconcileMemoryDocuments((await mapConcurrent(index.sources, async source => {
    options.signal?.throwIfAborted()
    try { return await readMemoryDocument(source.source, index.root) } catch { return null }
  })).filter((document): document is MemoryDocument => document !== null))
  const live = new Map(liveDocuments.filter(document => document.status === 'active').map(document => [document.source, document]))
  const entries = index.entries.filter(entry => live.get(entry.source)?.digest === entry.sourceDigest)
  const retained = new Set(entries)
  const staleSources = [...new Set(index.entries.filter(entry => !retained.has(entry)).map(entry => entry.source))]
  let vector: number[] = []
  let embeddingReason = index.embeddingReason
  if (!options.lexical && entries.some(entry => validEmbedding(entry.vector))) {
    try {
      const vectors = await (options.embed ?? embedTexts)([query], { model: index.model, signal: AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(10_000)]) })
      validateEmbeddings(vectors, 1, entries.find(entry => entry.vector?.length)?.vector?.length)
      vector = vectors[0]!; embeddingReason = undefined
    } catch (error) {
      options.signal?.throwIfAborted()
      embeddingReason = error instanceof Error ? error.message : String(error)
    }
  }
  const lexical = lexicalScores(query, entries.map(entry => `${entry.source} ${entry.text}`))
  const results = entries.map((entry, i): MemorySearchResult => {
    const semanticScore = vector.length && entry.vector ? cosineSimilarity(vector, entry.vector) : 0
    const lexicalScore = lexical[i] ?? 0
    return { ...entry, lexicalScore, semanticScore, score: lexicalScore + Math.max(0, semanticScore) * 0.6 }
  }).filter(result => result.lexicalScore > 0 || result.semanticScore >= (options.minimumSemanticScore ?? 0.35))
  results.sort((a, b) => b.score - a.score || a.source.localeCompare(b.source) || a.startLine - b.startLine)
  return { results: results.slice(0, options.limit ?? 8), mode: vector.length ? 'hybrid' : 'lexical', embeddingReason, staleSources }
}
