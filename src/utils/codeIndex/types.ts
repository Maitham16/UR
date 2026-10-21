/**
 * Types for the local, embedding-based semantic code index.
 *
 * The index lives at <root>/.ur/code-index/index.json and is built from the
 * project's source files using a local Ollama embedding model. It is the data
 * behind CodeSearchTool, which complements (does not replace) Grep/Glob:
 * Grep finds exact strings, CodeSearch finds semantically related code.
 */

export type CodeChunk = {
  /** Stable id: `${file}#${startLine}-${endLine}`. */
  id: string
  /** Project-relative POSIX path. */
  file: string
  startLine: number
  endLine: number
  text: string
  /** Embedding vector for `text`. */
  vector: number[]
}

export type IndexedFile = {
  /** sha1 of the file's UTF-8 content at index time (incremental-update key). */
  hash: string
  chunkIds: string[]
  symbols?: string[]
  imports?: string[]
  /** Last indexed source line; coverage reports files with omitted chunks. */
  indexedThroughLine?: number
}

export type CodeIndex = {
  version: 1 | 2
  /** Embedding model the vectors were produced with. */
  model: string
  /** Vector dimensionality (0 until the first chunk is embedded). */
  dim: number
  /** Absolute root the index was built from. */
  root: string
  builtAt: string
  /** file path -> file record. */
  files: Record<string, IndexedFile>
  /** chunk id -> chunk. */
  chunks: Record<string, CodeChunk>
  coverage?: IndexCoverage
  embedding?: { available: boolean; reason?: string }
}

export type IndexCoverage = {
  candidates: number
  indexed: number
  omittedByLimit: number
  skipped: Array<{ file: string; reason: string }>
  truncatedFiles: string[]
  maxFiles: number | null
  complete: boolean
}

export type CodeSearchHit = {
  file: string
  startLine: number
  endLine: number
  /** Hybrid relevance score; higher is more relevant, not a probability. */
  score: number
  preview: string
  sourceHash?: string
  reasons?: string[]
}

export type IndexBuildStats = {
  filesIndexed: number
  filesSkipped: number
  filesRemoved: number
  chunksTotal: number
  chunksEmbedded: number
  reused: boolean
  model: string
  dim: number
  coverage: IndexCoverage
  embedding: { available: boolean; reason?: string }
}
