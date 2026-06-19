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
}

export type CodeIndex = {
  version: 1
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
}

export type CodeSearchHit = {
  file: string
  startLine: number
  endLine: number
  /** Cosine similarity in [-1, 1]; higher is more relevant. */
  score: number
  preview: string
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
}
