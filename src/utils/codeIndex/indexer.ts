/**
 * Build/update and query the local semantic code index.
 *
 * Incremental: each file's content is hashed; unchanged files keep their
 * existing chunk vectors, so re-indexing a large repo after a small edit only
 * re-embeds what changed. Deleted files are pruned.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { ripGrep } from '../ripgrep.js'
import { chunkText } from './chunker.js'
import { embedTexts, getEmbeddingModel } from './embeddings.js'
import { extractImports, extractSymbols, resolveImport } from './structure.js'
import { lexicalScores, mapConcurrent, retrievalTerms, validateEmbeddings, type EmbeddingFunction } from '../retrieval.js'
import { cosineSimilarity, loadIndex, saveIndex, sha1 } from './store.js'
import type {
  CodeChunk,
  CodeIndex,
  CodeSearchHit,
  IndexBuildStats,
  IndexedFile,
} from './types.js'

// Source-ish extensions worth embedding. Lock files, minified bundles, and
// binary assets are intentionally excluded (handled below by name/size too).
const INDEXABLE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
  '.py', '.pyi', '.rb', '.go', '.rs', '.java', '.kt', '.kts', '.scala',
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hpp', '.hxx', '.cs', '.swift',
  '.php', '.lua', '.dart', '.ex', '.exs', '.erl', '.clj', '.hs', '.ml',
  '.sh', '.bash', '.zsh', '.sql', '.graphql', '.gql', '.proto',
  '.vue', '.svelte', '.astro', '.css', '.scss', '.sass', '.less',
  '.md', '.mdx', '.rst', '.adoc', '.txt',
  '.json', '.yaml', '.yml', '.toml',
])

// Skip files that are large or generated — embedding them wastes time/space.
const MAX_FILE_BYTES = 200_000
const EMBED_BATCH_SIZE = 32
// Names/segments that are never useful to index.
const SKIP_SEGMENTS = ['node_modules', '.git', 'dist', 'build', '.ur']

function toPosix(p: string): string {
  return sep === '\\' ? p.replaceAll('\\', '/') : p
}

function hasIndexableExtension(file: string): boolean {
  const dot = file.lastIndexOf('.')
  if (dot < 0) return false
  return INDEXABLE_EXTENSIONS.has(file.slice(dot).toLowerCase())
}

function isSkipped(relPath: string): boolean {
  const segments = relPath.split('/')
  if (segments.some(seg => SKIP_SEGMENTS.includes(seg))) return true
  if (relPath.endsWith('.min.js') || relPath.endsWith('.min.css')) return true
  if (relPath.endsWith('.lock') || relPath.endsWith('lock.json')) return true
  return false
}

async function walkIndexableFiles(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.github') continue
      const abs = resolve(dir, entry.name)
      const rel = toPosix(relative(root, abs))
      if (isSkipped(rel)) continue
      if (entry.isDirectory()) {
        await walk(abs)
      } else if (entry.isFile() && hasIndexableExtension(rel)) {
        out.push(rel)
      }
    }
  }
  await walk(root)
  return out.sort()
}

/** List candidate source files (relative POSIX paths), honoring .gitignore when ripgrep is available. */
export async function listIndexableFiles(
  root: string,
  signal: AbortSignal,
): Promise<string[]> {
  let absFiles: string[]
  try {
    absFiles = await ripGrep(['--files', '--hidden'], root, signal)
  } catch {
    signal.throwIfAborted()
    absFiles = await walkIndexableFiles(root)
  }
  const result: string[] = []
  for (const abs of absFiles) {
    const rel = toPosix(isAbsolute(abs) ? relative(root, abs) : abs)
    if (!rel || rel.startsWith('..')) continue
    if (isSkipped(rel)) continue
    if (!hasIndexableExtension(rel)) continue
    result.push(rel)
  }
  return result.sort()
}

export type BuildOptions = {
  root: string
  model?: string
  signal: AbortSignal
  /** Explicit optional cap; default indexes every eligible file. */
  maxFiles?: number
  lexical?: boolean
  embed?: EmbeddingFunction
  onProgress?: (done: number, total: number) => void
}

/** Atomic, incrementally reused hybrid index. Version 1 is upgraded on build. */
export async function buildOrUpdateIndex(options: BuildOptions): Promise<{ index: CodeIndex; stats: IndexBuildStats }> {
  const root = resolve(options.root)
  const model = options.model ?? getEmbeddingModel()
  if (options.maxFiles !== undefined && (!Number.isInteger(options.maxFiles) || options.maxFiles < 1)) throw new Error('maxFiles must be a positive integer')
  const existing = await loadIndex(root)
  const reusable = existing?.model === model ? existing : null
  const candidates = await listIndexableFiles(root, options.signal)
  const files = candidates.slice(0, options.maxFiles)
  const fileSet = new Set(candidates)
  const nextFiles: Record<string, IndexedFile> = {}
  const nextChunks: Record<string, CodeChunk> = {}
  const toEmbed: CodeChunk[] = []
  const skipped: Array<{ file: string; reason: string }> = []
  const truncatedFiles: string[] = []
  let dim = reusable?.dim ?? 0

  for (const rel of files) {
    options.signal.throwIfAborted()
    const abs = resolve(root, rel)
    let content: string
    try {
      const info = await stat(abs)
      if (!info.isFile() || info.size > MAX_FILE_BYTES) {
        skipped.push({ file: rel, reason: `Not a regular file or exceeds ${MAX_FILE_BYTES} bytes` })
        continue
      }
      content = await readFile(abs, 'utf8')
    } catch (error) {
      skipped.push({ file: rel, reason: error instanceof Error ? error.message : String(error) })
      continue
    }
    const hash = sha1(content)
    const prior = reusable?.files[rel]
    const rawChunks = chunkText(content)
    const chunkIds: string[] = []
    for (const raw of rawChunks) {
      const id = `${rel}#${raw.startLine}-${raw.endLine}`
      const previous = prior?.hash === hash ? reusable?.chunks[id] : undefined
      const chunk: CodeChunk = { id, file: rel, ...raw, vector: previous?.vector ?? [] }
      chunkIds.push(id)
      nextChunks[id] = chunk
      if (!options.lexical && !chunk.vector.length) toEmbed.push(chunk)
    }
    const indexedThroughLine = rawChunks.at(-1)?.endLine ?? 0
    if (rawChunks.length && indexedThroughLine < content.split('\n').length) truncatedFiles.push(rel)
    nextFiles[rel] = {
      hash, chunkIds, indexedThroughLine,
      symbols: extractSymbols(content),
      imports: extractImports(content).map(spec => resolveImport(rel, spec, fileSet)).filter((file): file is string => file !== null),
    }
  }

  let embedded = 0
  let embedding: { available: boolean; reason?: string } = options.lexical
    ? { available: false, reason: 'Lexical mode explicitly requested' }
    : { available: true }
  for (let i = 0; i < toEmbed.length; i += EMBED_BATCH_SIZE) {
    options.signal.throwIfAborted()
    const batch = toEmbed.slice(i, i + EMBED_BATCH_SIZE)
    try {
      const vectors = await (options.embed ?? embedTexts)(batch.map(chunk => chunk.text), {
        model, signal: AbortSignal.any([options.signal, AbortSignal.timeout(10_000)]),
      })
      validateEmbeddings(vectors, batch.length, dim)
      dim = vectors[0]!.length
      batch.forEach((chunk, j) => { chunk.vector = vectors[j]! })
      embedded += batch.length
      options.onProgress?.(embedded, toEmbed.length)
    } catch (error) {
      options.signal.throwIfAborted()
      embedding = { available: false, reason: error instanceof Error ? error.message : String(error) }
      break // Keep lexical coverage; never repeatedly call an unavailable service.
    }
  }
  if (options.lexical) {
    for (const chunk of Object.values(nextChunks)) chunk.vector = []
    dim = 0
  }
  const coverage = {
    candidates: candidates.length, indexed: Object.keys(nextFiles).length,
    omittedByLimit: candidates.length - files.length, skipped, truncatedFiles,
    maxFiles: options.maxFiles ?? null,
    complete: files.length === candidates.length && !skipped.length && !truncatedFiles.length,
  }
  const index: CodeIndex = {
    version: 2, model, dim, root, builtAt: new Date().toISOString(),
    files: nextFiles, chunks: nextChunks, coverage, embedding,
  }
  options.signal.throwIfAborted()
  await saveIndex(root, index)
  return {
    index,
    stats: {
      filesIndexed: coverage.indexed, filesSkipped: skipped.length,
      filesRemoved: reusable ? Object.keys(reusable.files).filter(file => !nextFiles[file]).length : 0,
      chunksTotal: Object.keys(nextChunks).length, chunksEmbedded: embedded,
      reused: Boolean(reusable), model, dim, coverage, embedding,
    },
  }
}

export type SearchOptions = {
  root: string
  query: string
  k?: number
  path?: string
  signal: AbortSignal
  model?: string
  lexical?: boolean
  embed?: EmbeddingFunction
}

export type SearchDiagnostics = {
  mode: 'hybrid' | 'lexical'
  embeddingReason?: string
  staleFiles: string[]
  missingFiles: string[]
  checkedFiles: number
  coverage: CodeIndex['coverage'] | null
  durationMs: number
}

/** Revalidate every candidate source, then combine meaning, words and structure. */
export async function searchCode(options: SearchOptions): Promise<{ hits: CodeSearchHit[]; index: CodeIndex | null; diagnostics: SearchDiagnostics }> {
  const started = performance.now()
  const root = resolve(options.root)
  const index = await loadIndex(root)
  const diagnostics: SearchDiagnostics = { mode: 'lexical', staleFiles: [], missingFiles: [], checkedFiles: 0, coverage: index?.coverage ?? null, durationMs: 0 }
  if (!index) return { hits: [], index: null, diagnostics }
  if (options.model && options.model !== index.model) throw new Error(`Index uses ${index.model}; rebuild before querying with ${options.model}`)
  const pathPrefix = options.path?.replaceAll('\\', '/').replace(/\/$/, '')
  const current = new Set<string>()
  const indexedPaths = new Set(Object.keys(index.files))
  await mapConcurrent(Object.entries(index.files), async ([file, record]) => {
    options.signal.throwIfAborted()
    // Indexes copied from another checkout use this checkout's files. Never
    // follow an index's absolute root or an escaping persisted relative path.
    const absolute = resolve(root, file)
    if (relative(root, absolute).startsWith('..') || isAbsolute(file)) {
      diagnostics.missingFiles.push(file)
      return
    }
    diagnostics.checkedFiles++
    try {
      const content = await readFile(absolute, 'utf8')
      if (sha1(content) !== record.hash) diagnostics.staleFiles.push(file)
      else {
        current.add(file)
        // Older indexes acquire structure in memory without a forced rebuild.
        record.symbols ??= extractSymbols(content)
        record.imports ??= extractImports(content).map(spec => resolveImport(file, spec, indexedPaths)).filter((target): target is string => target !== null)
      }
    } catch { diagnostics.missingFiles.push(file) }
  })
  diagnostics.staleFiles.sort()
  diagnostics.missingFiles.sort()
  let queryVector: number[] = []
  if (!options.lexical && index.dim > 0) {
    try {
      const vectors = await (options.embed ?? embedTexts)([options.query], {
        model: index.model, signal: AbortSignal.any([options.signal, AbortSignal.timeout(10_000)]),
      })
      validateEmbeddings(vectors, 1, index.dim)
      queryVector = vectors[0]!
      diagnostics.mode = 'hybrid'
    } catch (error) {
      options.signal.throwIfAborted()
      diagnostics.embeddingReason = error instanceof Error ? error.message : String(error)
    }
  } else diagnostics.embeddingReason = options.lexical ? 'Lexical mode explicitly requested' : index.embedding?.reason ?? 'Index has no embeddings; build with an available embedding model for semantic recall'

  const chunks = Object.values(index.chunks).filter(chunk => current.has(chunk.file) && index.files[chunk.file]?.chunkIds.includes(chunk.id) && (!pathPrefix || chunk.file === pathPrefix || chunk.file.startsWith(`${pathPrefix}/`)))
  const lexical = lexicalScores(options.query, chunks.map(chunk => `${chunk.file} ${chunk.text}`))
  const queryTerms = new Set(retrievalTerms(options.query))
  const symbolMatches = new Set(Object.entries(index.files).filter(([file, record]) => current.has(file) && record.symbols?.some(symbol => retrievalTerms(symbol).every(term => queryTerms.has(term)))).map(([file]) => file))
  const neighbors = new Set<string>()
  for (const [file, record] of Object.entries(index.files)) {
    if (!current.has(file)) continue
    for (const dependency of record.imports ?? []) {
      if (symbolMatches.has(dependency)) neighbors.add(file)
      if (symbolMatches.has(file) && current.has(dependency)) neighbors.add(dependency)
    }
  }
  const scored: CodeSearchHit[] = chunks.map((chunk, i) => {
    const semantic = queryVector.length ? Math.max(0, cosineSimilarity(queryVector, chunk.vector)) : 0
    const symbol = symbolMatches.has(chunk.file) ? 0.4 : 0
    const dependency = neighbors.has(chunk.file) ? 0.15 : 0
    return {
      file: chunk.file, startLine: chunk.startLine, endLine: chunk.endLine,
      score: (lexical[i] ?? 0) + semantic * 0.6 + symbol + dependency,
      preview: chunk.text.split('\n').slice(0, 8).join('\n'),
      sourceHash: index.files[chunk.file]!.hash,
      reasons: [...(lexical[i] > 0 ? ['text'] : []), ...(semantic > 0 ? ['embedding'] : []), ...(symbol ? ['symbol'] : []), ...(dependency ? ['dependency'] : [])],
    }
  }).filter(hit => hit.score > 0)
  scored.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.startLine - b.startLine)
  diagnostics.durationMs = performance.now() - started
  const k = Number.isFinite(options.k) ? Math.max(1, Math.trunc(options.k!)) : 10
  return { hits: scored.slice(0, k), index, diagnostics }
}
