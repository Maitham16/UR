import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'
import { buildMemoryIndex, loadMemoryIndex, searchMemoryIndex, semanticMemoryIndexPath } from '../../memdir/retrieval.js'

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const command = tokens.find(token => !token.startsWith('--')) ?? 'status'
  const root = getCwd()
  const lexical = tokens.includes('--lexical')
  if (command === 'status') {
    const index = await loadMemoryIndex(root)
    const status = index
      ? { builtAt: index.builtAt, mode: index.mode, model: index.model, embeddingReason: index.embeddingReason, entries: index.entries.length, sources: index.sources, unreadable: index.unreadable, path: semanticMemoryIndexPath(root), freshness: 'Sources revalidated at every build/search; status describes the last build' }
      : { entries: 0, path: semanticMemoryIndexPath(root), missing: true, action: 'Run build or search; legacy indexes rebuild from current sources automatically' }
    return { type: 'text', value: JSON.stringify(status, null, 2) }
  }
  if (command === 'build' || command === 'search') {
    const query = tokens.filter(token => !token.startsWith('--') && token !== 'search').join(' ')
    if (command === 'search' && !query.trim()) return { type: 'text', value: 'Usage: ur semantic-memory search <query> [--json] [--lexical]' }
    const index = await buildMemoryIndex({ root, lexical })
    if (command === 'build') return {
      type: 'text', value: json ? JSON.stringify(index, null, 2)
        : `Built ${index.entries.length} memory entries (${index.mode}) at ${semanticMemoryIndexPath(root)}${index.embeddingReason ? `\nEmbedding status: ${index.embeddingReason}` : ''}\n${index.sources.filter(source => source.status !== 'active').length} inactive sources excluded; ${index.unreadable.length} unreadable sources.`,
    }
    const result = await searchMemoryIndex(index, query, { lexical })
    const status = `${result.mode} retrieval${result.embeddingReason ? `; embeddings unavailable: ${result.embeddingReason}` : ''}`
    if (json) return { type: 'text', value: JSON.stringify({ ...result, excluded: index.sources.filter(source => source.status !== 'active'), unreadable: index.unreadable }, null, 2) }
    return {
      type: 'text', value: `${status}\n\n${result.results.length ? result.results.map(entry => `${entry.source}:${entry.startLine}-${entry.endLine} (${entry.score.toFixed(3)}; sha256 ${entry.sourceDigest})${entry.conflicts.length ? `\nConflicting memories — review together: ${entry.conflicts.join(', ')}` : ''}\n${entry.text}`).join('\n\n') : 'No memory matches.'}`,
    }
  }
  return { type: 'text', value: 'Usage: ur semantic-memory build|search|status [query] [--json] [--lexical]' }
}
