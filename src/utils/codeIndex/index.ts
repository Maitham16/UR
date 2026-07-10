/**
 * Public API for the local semantic code index.
 *
 * Local-first: embeddings are produced by the same local Ollama app UR uses
 * for chat. Opt-in: gated by the UR_CODE_INDEX env flag (see CodeSearchTool
 * and `ur code-index`). Complements Grep/Glob with similarity search.
 */

export { getEmbeddingModel, DEFAULT_EMBED_MODEL } from './embeddings.js'
import { existsSync } from 'node:fs'
import { indexPath } from './store.js'

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
export {
  buildRepoIndex,
  callIndexPath,
  configIndexPath,
  docIndexPath,
  docSearch,
  findCallers,
  findTestsForFile,
  formatRepoStats,
  loadCallIndex,
  loadConfigIndex,
  loadDocIndex,
  loadRepoIndex,
  loadSymbolIndex,
  loadTestIndex,
  repoIndexDir,
  repoIndexPath,
  repoSearch,
  symbolIndexPath,
  symbolSearch,
  testIndexPath,
} from './repoIndex.js'
export type {
  CallEntry,
  CallGraphIndex,
  ConfigEntry,
  ConfigIndex,
  DocEntry,
  DocIndex,
  RepoFileEntry,
  RepoIndex,
  SymbolEntry,
  SymbolIndex,
  TestEntry,
  TestIndex,
} from './repoIndex.js'
export type {
  CodeChunk,
  CodeIndex,
  CodeSearchHit,
  IndexBuildStats,
  IndexedFile,
} from './types.js'

/**
 * Whether the semantic code index feature is enabled.
 *
 * Zero-config: enabled automatically when a built index exists on disk for
 * the current project (`ur code-index build` creates it), so the CodeSearch
 * tool appears the moment there is something to search — no env var needed.
 * UR_CODE_INDEX still works as an explicit override in both directions:
 * truthy forces it on (pre-index), `0`/`false`/`off` forces it off even
 * with an index present. Positive presence is cached per cwd (an index
 * rarely disappears); absence is re-probed each call so the tool appears
 * immediately after `ur code-index build` — one existsSync costs
 * microseconds, cheap enough for tool-pool assembly hot paths.
 */
let indexPresentFor: string | null = null

export function isCodeIndexEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const value = (env.UR_CODE_INDEX || '').trim().toLowerCase()
  if (value === '0' || value === 'false' || value === 'off') return false
  if (value !== '') return true

  const cwd = process.cwd()
  if (indexPresentFor === cwd) return true
  try {
    if (existsSync(indexPath(cwd))) {
      indexPresentFor = cwd
      return true
    }
  } catch {
    // fall through
  }
  return false
}
