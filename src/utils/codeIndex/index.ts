/**
 * Public API for the local semantic code index.
 *
 * Local-first: embeddings are produced by the same local Ollama app UR uses
 * for chat. Opt-in: gated by the UR_CODE_INDEX env flag (see CodeSearchTool
 * and `ur code-index`). Complements Grep/Glob with similarity search.
 */

export { getEmbeddingModel, DEFAULT_EMBED_MODEL } from './embeddings.js'
export { cosineSimilarity, indexPath, loadIndex } from './store.js'
export {
  buildOrUpdateIndex,
  listIndexableFiles,
  searchCode,
} from './indexer.js'
export {
  buildCodeGraph,
  buildGraphFromFiles,
  dependenciesOf,
  extractImports,
  extractSymbols,
  formatGraphStats,
  graphPath,
  graphSearch,
  impactOf,
  loadGraph,
  resolveImport,
  whereDefined,
} from './graph.js'
export type { CodeGraph, GraphHit, SourceFile } from './graph.js'
export type {
  CodeChunk,
  CodeIndex,
  CodeSearchHit,
  IndexBuildStats,
  IndexedFile,
} from './types.js'

/** Whether the semantic code index feature is enabled (opt-in). */
export function isCodeIndexEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const value = (env.UR_CODE_INDEX || '').trim().toLowerCase()
  return value !== '' && value !== '0' && value !== 'false' && value !== 'off'
}
