/**
 * Build/update and query the local semantic code index.
 *
 * Incremental: each file's content is hashed; unchanged files keep their
 * existing chunk vectors, so re-indexing a large repo after a small edit only
 * re-embeds what changed. Deleted files are pruned.
 */

import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { ripGrep } from '../ripgrep.js'
import { chunkText } from './chunker.js'
import { embedQuery, embedTexts, getEmbeddingModel } from './embeddings.js'
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
const DEFAULT_MAX_FILES = 5_000
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

/** List candidate source files (relative POSIX paths), honoring .gitignore. */
export async function listIndexableFiles(
  root: string,
  signal: AbortSignal,
): Promise<string[]> {
  let absFiles: string[]
  try {
    absFiles = await ripGrep(['--files', '--hidden'], root, signal)
  } catch {
    return []
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
  maxFiles?: number
  onProgress?: (done: number, total: number) => void
}

/**
 * Build or incrementally update the index. Returns the index plus stats.
 */
export async function buildOrUpdateIndex(
  options: BuildOptions,
): Promise<{ index: CodeIndex; stats: IndexBuildStats }> {
  const root = resolve(options.root)
  const model = options.model ?? getEmbeddingModel()
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES

  // Reuse the existing index only if it was built with the same model.
  const existing = await loadIndex(root)
  const reusable = existing && existing.model === model ? existing : null

  const files = (await listIndexableFiles(root, options.signal)).slice(0, maxFiles)

  const nextFiles: Record<string, IndexedFile> = {}
  const nextChunks: Record<string, CodeChunk> = {}
  const toEmbed: Array<{ id: string; chunk: Omit<CodeChunk, 'vector'> }> = []

  let filesIndexed = 0
  let filesSkipped = 0
  let dim = reusable?.dim ?? 0

  for (const rel of files) {
    if (options.signal.aborted) throw new Error('aborted')
    const abs = resolve(root, rel)
    let content: string
    try {
      const info = await stat(abs)
      if (!info.isFile() || info.size > MAX_FILE_BYTES) {
        filesSkipped++
        continue
      }
      content = await readFile(abs, { encoding: 'utf-8' })
    } catch {
      filesSkipped++
      continue
    }

    const hash = sha1(content)
    const prior = reusable?.files[rel]
    if (prior && prior.hash === hash) {
      // Unchanged — reuse prior chunks verbatim.
      const reusedChunks = prior.chunkIds
        .map(id => reusable?.chunks[id])
        .filter((c): c is CodeChunk => Boolean(c))
      if (reusedChunks.length === prior.chunkIds.length) {
        nextFiles[rel] = { hash, chunkIds: prior.chunkIds }
        for (const chunk of reusedChunks) nextChunks[chunk.id] = chunk
        filesIndexed++
        continue
      }
    }

    // Changed or new — (re)chunk and queue for embedding.
    const rawChunks = chunkText(content)
    const chunkIds: string[] = []
    for (const raw of rawChunks) {
      const id = `${rel}#${raw.startLine}-${raw.endLine}`
      chunkIds.push(id)
      toEmbed.push({
        id,
        chunk: {
          id,
          file: rel,
          startLine: raw.startLine,
          endLine: raw.endLine,
          text: raw.text,
        },
      })
    }
    nextFiles[rel] = { hash, chunkIds }
    filesIndexed++
  }

  // Embed all new/changed chunks in batches.
  let embedded = 0
  for (let i = 0; i < toEmbed.length; i += EMBED_BATCH_SIZE) {
    if (options.signal.aborted) throw new Error('aborted')
    const batch = toEmbed.slice(i, i + EMBED_BATCH_SIZE)
    const vectors = await embedTexts(
      batch.map(b => b.chunk.text),
      { model, signal: options.signal },
    )
    for (let j = 0; j < batch.length; j++) {
      const entry = batch[j]!
      const vector = vectors[j] ?? []
      if (dim === 0 && vector.length > 0) dim = vector.length
      nextChunks[entry.id] = { ...entry.chunk, vector }
    }
    embedded += batch.length
    options.onProgress?.(embedded, toEmbed.length)
  }

  const filesRemoved = reusable
    ? Object.keys(reusable.files).filter(f => !nextFiles[f]).length
    : 0

  const index: CodeIndex = {
    version: 1,
    model,
    dim,
    root,
    builtAt: new Date().toISOString(),
    files: nextFiles,
    chunks: nextChunks,
  }
  await saveIndex(root, index)

  return {
    index,
    stats: {
      filesIndexed,
      filesSkipped,
      filesRemoved,
      chunksTotal: Object.keys(nextChunks).length,
      chunksEmbedded: embedded,
      reused: Boolean(reusable),
      model,
      dim,
    },
  }
}

export type SearchOptions = {
  root: string
  query: string
  k?: number
  signal: AbortSignal
  model?: string
}

/**
 * Search the existing index for chunks semantically similar to `query`.
 * Returns [] if no index exists (caller should prompt to build).
 */
export async function searchCode(
  options: SearchOptions,
): Promise<{ hits: CodeSearchHit[]; index: CodeIndex | null }> {
  const root = resolve(options.root)
  const index = await loadIndex(root)
  if (!index) {
    return { hits: [], index: null }
  }
  const model = options.model ?? index.model
  const queryVector = await embedQuery(options.query, {
    model,
    signal: options.signal,
  })

  const k = Math.max(1, options.k ?? 10)
  const scored: CodeSearchHit[] = []
  for (const chunk of Object.values(index.chunks)) {
    const score = cosineSimilarity(queryVector, chunk.vector)
    scored.push({
      file: chunk.file,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      score,
      preview: previewOf(chunk.text),
    })
  }
  scored.sort((a, b) => b.score - a.score)
  return { hits: scored.slice(0, k), index }
}

function previewOf(text: string, maxLines = 8): string {
  const lines = text.split('\n').slice(0, maxLines)
  return lines.join('\n')
}
