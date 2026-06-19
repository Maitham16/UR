import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { safeParseJSON } from '../../utils/json.js'
import { type Embedder, cosineSimilarity } from './embeddings.js'

/**
 * First-class project knowledge bases (lightweight RAG).
 *
 * Unlike the auto-built semantic-memory index, a knowledge base is an
 * explicitly curated set of sources (files, directories, or inline notes) with
 * provenance (path + line range + timestamp) attached to every chunk, plus
 * retention controls. Search returns source-attributed snippets suitable for
 * grounding answers and feeding the claim-provenance ledger.
 */

export type KnowledgeKind = 'file' | 'dir' | 'note'

export type KnowledgeSource = {
  id: string
  kind: KnowledgeKind
  ref: string
  label?: string
  addedAt: string
}

export type KnowledgeChunk = {
  id: string
  sourceId: string
  ref: string
  startLine: number
  endLine: number
  text: string
  tokens: string[]
  addedAt: string
  embedding?: number[]
}

export type KnowledgeIndex = {
  version: 1
  mode: 'lexical' | 'embedding'
  builtAt: string
  embedModel?: string
  chunks: KnowledgeChunk[]
}

export type BuildIndexOptions = { embedder?: Embedder; embedModel?: string }
export type SearchOptions = { limit?: number; embedder?: Embedder }

export type KnowledgeSearchResult = KnowledgeChunk & { score: number }

const TEXT_EXT_RE = /\.(md|mdx|markdown|txt|rst|adoc)$/i
const SECRET_FILE_RE = /(^|\/)\.env(\.|$)|secrets?\.|\.pem$|\.key$/i
const MAX_DIR_FILES = 200
const MAX_CHUNK_CHARS = 1600

function knowledgeDir(cwd: string): string {
  return join(cwd, '.ur', 'knowledge')
}

function sourcesPath(cwd: string): string {
  return join(knowledgeDir(cwd), 'sources.json')
}

function indexPath(cwd: string): string {
  return join(knowledgeDir(cwd), 'index', 'index.json')
}

export function tokenize(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? [])]
}

export function loadSources(cwd: string): KnowledgeSource[] {
  const path = sourcesPath(cwd)
  if (!existsSync(path)) return []
  const parsed = safeParseJSON(readFileSync(path, 'utf-8'), false)
  return Array.isArray(parsed) ? (parsed as KnowledgeSource[]) : []
}

function saveSources(cwd: string, sources: KnowledgeSource[]): void {
  mkdirSync(knowledgeDir(cwd), { recursive: true })
  writeFileSync(sourcesPath(cwd), `${JSON.stringify(sources, null, 2)}\n`)
}

function makeSourceId(kind: KnowledgeKind, ref: string): string {
  const slug = ref
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return `${kind}:${slug || 'note'}`
}

export type AddSourceResult = {
  source: KnowledgeSource
  alreadyExists: boolean
}

export function addSource(
  cwd: string,
  rawRef: string,
  options: { label?: string; note?: boolean } = {},
): AddSourceResult {
  const ref = rawRef.trim()
  if (!ref) throw new Error('Provide a file, directory, or note to add')

  let kind: KnowledgeKind
  if (options.note) {
    kind = 'note'
  } else {
    const abs = resolve(cwd, ref)
    if (!existsSync(abs)) {
      throw new Error(`Path not found: ${ref} (use --note to add inline text)`)
    }
    kind = statSync(abs).isDirectory() ? 'dir' : 'file'
  }

  const source: KnowledgeSource = {
    id: makeSourceId(kind, ref),
    kind,
    ref,
    label: options.label,
    addedAt: new Date().toISOString(),
  }
  const sources = loadSources(cwd)
  const existing = sources.find(item => item.id === source.id)
  if (existing) return { source: existing, alreadyExists: true }
  sources.push(source)
  saveSources(cwd, sources)
  return { source, alreadyExists: false }
}

export function removeSource(cwd: string, idOrRef: string): boolean {
  const sources = loadSources(cwd)
  const next = sources.filter(
    item => item.id !== idOrRef && item.ref !== idOrRef,
  )
  if (next.length === sources.length) return false
  saveSources(cwd, next)
  return true
}

function collectFiles(cwd: string, source: KnowledgeSource): string[] {
  if (source.kind === 'note') return []
  const abs = resolve(cwd, source.ref)
  if (source.kind === 'file') return [abs]
  const files: string[] = []
  const walk = (dir: string) => {
    if (files.length >= MAX_DIR_FILES) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules') continue
      const full = join(dir, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) walk(full)
      else if (TEXT_EXT_RE.test(entry) && !SECRET_FILE_RE.test(full)) {
        files.push(full)
      }
      if (files.length >= MAX_DIR_FILES) return
    }
  }
  walk(abs)
  return files
}

function chunkFile(
  cwd: string,
  source: KnowledgeSource,
  absPath: string,
): KnowledgeChunk[] {
  if (SECRET_FILE_RE.test(absPath)) return []
  let content: string
  try {
    content = readFileSync(absPath, 'utf-8')
  } catch {
    return []
  }
  const ref = relative(cwd, absPath) || absPath
  const lines = content.split('\n')
  const chunks: KnowledgeChunk[] = []
  let buffer: string[] = []
  let startLine = 1
  const flush = (endLine: number) => {
    const text = buffer.join('\n').trim()
    if (text) {
      chunks.push({
        id: `${basename(ref)}:${startLine}`,
        sourceId: source.id,
        ref,
        startLine,
        endLine,
        text: text.length > MAX_CHUNK_CHARS ? `${text.slice(0, MAX_CHUNK_CHARS)}…` : text,
        tokens: tokenize(text),
        addedAt: source.addedAt,
      })
    }
    buffer = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') {
      if (buffer.length > 0) flush(i)
      startLine = i + 2
    } else {
      if (buffer.length === 0) startLine = i + 1
      buffer.push(line)
    }
  }
  if (buffer.length > 0) flush(lines.length)
  return chunks.slice(0, 500)
}

function chunkNote(source: KnowledgeSource): KnowledgeChunk[] {
  const text = source.ref.trim()
  if (!text) return []
  return [
    {
      id: `${source.id}:1`,
      sourceId: source.id,
      ref: 'note',
      startLine: 1,
      endLine: 1,
      text: text.length > MAX_CHUNK_CHARS ? `${text.slice(0, MAX_CHUNK_CHARS)}…` : text,
      tokens: tokenize(text),
      addedAt: source.addedAt,
    },
  ]
}

export async function buildIndex(
  cwd: string,
  options: BuildIndexOptions = {},
): Promise<KnowledgeIndex> {
  const sources = loadSources(cwd)
  const chunks: KnowledgeChunk[] = []
  for (const source of sources) {
    if (source.kind === 'note') {
      chunks.push(...chunkNote(source))
      continue
    }
    for (const file of collectFiles(cwd, source)) {
      chunks.push(...chunkFile(cwd, source, file))
    }
  }

  let mode: KnowledgeIndex['mode'] = 'lexical'
  let embedModel: string | undefined
  if (options.embedder && chunks.length > 0) {
    const vectors = await options.embedder(chunks.map(chunk => chunk.text))
    if (vectors.length === chunks.length) {
      chunks.forEach((chunk, index) => {
        chunk.embedding = vectors[index]
      })
      mode = 'embedding'
      embedModel = options.embedModel
    }
  }

  const index: KnowledgeIndex = {
    version: 1,
    mode,
    builtAt: new Date().toISOString(),
    embedModel,
    chunks,
  }
  mkdirSync(join(knowledgeDir(cwd), 'index'), { recursive: true })
  writeFileSync(indexPath(cwd), `${JSON.stringify(index, null, 2)}\n`)
  return index
}

export function loadIndex(cwd: string): KnowledgeIndex | null {
  const path = indexPath(cwd)
  if (!existsSync(path)) return null
  const parsed = safeParseJSON(readFileSync(path, 'utf-8'), false)
  return parsed && typeof parsed === 'object'
    ? (parsed as KnowledgeIndex)
    : null
}

export async function searchKnowledge(
  cwd: string,
  query: string,
  options: SearchOptions = {},
): Promise<KnowledgeSearchResult[]> {
  const index = loadIndex(cwd) ?? (await buildIndex(cwd))
  const limit = options.limit ?? 8

  // Dense retrieval when the index has embeddings and an embedder is available.
  if (index.mode === 'embedding' && options.embedder) {
    try {
      const [queryVector] = await options.embedder([query])
      if (queryVector) {
        return index.chunks
          .filter(chunk => Array.isArray(chunk.embedding))
          .map(chunk => ({
            ...chunk,
            score: cosineSimilarity(queryVector, chunk.embedding as number[]),
          }))
          .filter(chunk => chunk.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
      }
    } catch {
      // Fall back to lexical scoring below.
    }
  }

  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) return []
  return index.chunks
    .map(chunk => {
      const tokenSet = new Set(chunk.tokens)
      const score = queryTokens.filter(token => tokenSet.has(token)).length
      return { ...chunk, score }
    })
    .filter(chunk => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

export type PruneResult = { removedSources: number; removedChunks: number }

/** Retention: drop sources (and their chunks) older than the given age. */
export function pruneKnowledge(
  cwd: string,
  options: { olderThanDays: number },
): PruneResult {
  const cutoff = Date.now() - options.olderThanDays * 24 * 60 * 60 * 1000
  const sources = loadSources(cwd)
  const kept = sources.filter(item => Date.parse(item.addedAt) >= cutoff)
  const removedSources = sources.length - kept.length
  saveSources(cwd, kept)
  const index = loadIndex(cwd)
  let removedChunks = 0
  if (index) {
    const keptIds = new Set(kept.map(item => item.id))
    const before = index.chunks.length
    index.chunks = index.chunks.filter(chunk => keptIds.has(chunk.sourceId))
    removedChunks = before - index.chunks.length
    index.builtAt = new Date().toISOString()
    mkdirSync(join(knowledgeDir(cwd), 'index'), { recursive: true })
    writeFileSync(indexPath(cwd), `${JSON.stringify(index, null, 2)}\n`)
  }
  return { removedSources, removedChunks }
}

export function knowledgeStatus(cwd: string): {
  sources: number
  chunks: number
  mode: KnowledgeIndex['mode'] | null
  embedModel: string | null
  builtAt: string | null
  indexPath: string
} {
  const sources = loadSources(cwd)
  const index = loadIndex(cwd)
  return {
    sources: sources.length,
    chunks: index?.chunks.length ?? 0,
    mode: index?.mode ?? null,
    embedModel: index?.embedModel ?? null,
    builtAt: index?.builtAt ?? null,
    indexPath: indexPath(cwd),
  }
}

export function formatSources(sources: KnowledgeSource[], json: boolean): string {
  if (json) return JSON.stringify({ sources }, null, 2)
  if (sources.length === 0) {
    return 'No knowledge sources yet. Add one: ur knowledge add <file|dir>'
  }
  const lines = ['Knowledge sources', '']
  for (const source of sources) {
    const label = source.label ? `  "${source.label}"` : ''
    const ref = source.kind === 'note' ? `${source.ref.slice(0, 60)}…` : source.ref
    lines.push(`${source.id}${label}`)
    lines.push(`  ${source.kind}: ${ref}   (added ${source.addedAt})`)
  }
  return lines.join('\n')
}

export function formatSearchResults(
  results: KnowledgeSearchResult[],
  json: boolean,
): string {
  if (json) return JSON.stringify({ results }, null, 2)
  if (results.length === 0) return 'No knowledge matches.'
  return results
    .map(
      result =>
        `${result.ref}:${result.startLine}-${result.endLine}  (score ${result.score})\n${result.text}`,
    )
    .join('\n\n')
}
