/**
 * Line-window chunking for source files. We use fixed line windows with a
 * small overlap rather than language-aware parsing: it is dependency-free,
 * works for every language, and is good enough for embedding retrieval where
 * the model only needs a coherent local region of code.
 */

export type RawChunk = {
  startLine: number // 1-based, inclusive
  endLine: number // 1-based, inclusive
  text: string
}

export type ChunkOptions = {
  /** Lines per chunk. */
  maxLines?: number
  /** Overlapping lines between consecutive chunks (preserves context). */
  overlap?: number
  /** Hard cap on chunks per file (protects against giant generated files). */
  maxChunks?: number
}

const DEFAULT_MAX_LINES = 60
const DEFAULT_OVERLAP = 10
const DEFAULT_MAX_CHUNKS = 200

/**
 * Split file content into overlapping line windows. Whitespace-only windows
 * are dropped. Returns [] for empty/whitespace-only input.
 */
export function chunkText(content: string, options: ChunkOptions = {}): RawChunk[] {
  const maxLines = Math.max(1, options.maxLines ?? DEFAULT_MAX_LINES)
  const overlap = Math.min(
    Math.max(0, options.overlap ?? DEFAULT_OVERLAP),
    maxLines - 1,
  )
  const maxChunks = Math.max(1, options.maxChunks ?? DEFAULT_MAX_CHUNKS)
  const step = maxLines - overlap

  if (!content.trim()) {
    return []
  }

  const lines = content.split('\n')
  const chunks: RawChunk[] = []

  for (let start = 0; start < lines.length; start += step) {
    const end = Math.min(start + maxLines, lines.length)
    const slice = lines.slice(start, end)
    const text = slice.join('\n')
    if (text.trim()) {
      chunks.push({ startLine: start + 1, endLine: end, text })
      if (chunks.length >= maxChunks) {
        break
      }
    }
    if (end >= lines.length) {
      break
    }
  }

  return chunks
}
