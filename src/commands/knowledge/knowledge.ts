import {
  DEFAULT_EMBED_MODEL,
  type Embedder,
  makeOllamaEmbedder,
} from '../../services/agents/embeddings.js'
import {
  addSource,
  buildIndex,
  formatSearchResults,
  formatSources,
  knowledgeStatus,
  loadIndex,
  loadSources,
  pruneKnowledge,
  removeSource,
  searchKnowledge,
} from '../../services/agents/knowledge.js'
import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'

function optionValue(tokens: string[], flag: string): string | undefined {
  const index = tokens.indexOf(flag)
  return index >= 0 ? tokens[index + 1] : undefined
}

export const call: LocalCommandCall = async (args: string) => {
  const cwd = getCwd()
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const note = tokens.includes('--note')
  const label = optionValue(tokens, '--label')
  const olderThan = optionValue(tokens, '--older-than')
  const flagsWithValues = new Set(['--label', '--older-than', '--embed-model'])
  const positional: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.startsWith('--')) {
      if (flagsWithValues.has(token)) i++
      continue
    }
    positional.push(token)
  }
  const command = positional[0] ?? 'status'

  if (command === 'add') {
    const ref = note ? positional.slice(1).join(' ') : positional[1]
    if (!ref) {
      return { type: 'text', value: 'Usage: ur knowledge add <file|dir> [--label <l>]  |  ur knowledge add --note "<text>"' }
    }
    try {
      const result = addSource(cwd, ref, { label, note })
      if (json) return { type: 'text', value: JSON.stringify(result, null, 2) }
      return {
        type: 'text',
        value: result.alreadyExists
          ? `Source already registered: ${result.source.id}`
          : `Added ${result.source.kind} source ${result.source.id}. Run: ur knowledge build`,
      }
    } catch (error) {
      return { type: 'text', value: error instanceof Error ? error.message : String(error) }
    }
  }

  if (command === 'remove') {
    const ref = positional[1]
    if (!ref) return { type: 'text', value: 'Usage: ur knowledge remove <id|ref>' }
    const removed = removeSource(cwd, ref)
    return {
      type: 'text',
      value: removed ? `Removed source ${ref}. Run: ur knowledge build` : `No source matched ${ref}.`,
    }
  }

  if (command === 'list') {
    return { type: 'text', value: formatSources(loadSources(cwd), json) }
  }

  if (command === 'build') {
    const useEmbeddings = tokens.includes('--embeddings')
    const embedModel = optionValue(tokens, '--embed-model') ?? DEFAULT_EMBED_MODEL
    const embedder: Embedder | undefined = useEmbeddings
      ? makeOllamaEmbedder(embedModel)
      : undefined
    let index
    try {
      index = await buildIndex(cwd, embedder ? { embedder, embedModel } : {})
    } catch (error) {
      return {
        type: 'text',
        value: `Embedding build failed (${error instanceof Error ? error.message : String(error)}). Run "ur knowledge build" for a lexical index.`,
      }
    }
    if (json) {
      return {
        type: 'text',
        value: JSON.stringify(
          { builtAt: index.builtAt, mode: index.mode, chunks: index.chunks.length },
          null,
          2,
        ),
      }
    }
    return {
      type: 'text',
      value: `Built ${index.mode} knowledge index: ${index.chunks.length} chunks from ${loadSources(cwd).length} sources.`,
    }
  }

  if (command === 'search') {
    const query = positional.slice(1).join(' ')
    if (!query) return { type: 'text', value: 'Usage: ur knowledge search <query>' }
    const existing = loadIndex(cwd)
    const wantEmbeddings =
      tokens.includes('--embeddings') || existing?.mode === 'embedding'
    const embedder: Embedder | undefined = wantEmbeddings
      ? makeOllamaEmbedder(
          existing?.embedModel ??
            optionValue(tokens, '--embed-model') ??
            DEFAULT_EMBED_MODEL,
        )
      : undefined
    const results = await searchKnowledge(cwd, query, embedder ? { embedder } : {})
    return { type: 'text', value: formatSearchResults(results, json) }
  }

  if (command === 'prune') {
    const days = Number(olderThan ?? '30')
    if (!Number.isFinite(days) || days <= 0) {
      return { type: 'text', value: 'Usage: ur knowledge prune --older-than <days>' }
    }
    const result = pruneKnowledge(cwd, { olderThanDays: days })
    if (json) return { type: 'text', value: JSON.stringify(result, null, 2) }
    return {
      type: 'text',
      value: `Pruned ${result.removedSources} sources and ${result.removedChunks} chunks older than ${days} days.`,
    }
  }

  if (command === 'status') {
    const status = knowledgeStatus(cwd)
    return { type: 'text', value: JSON.stringify(status, null, 2) }
  }

  return {
    type: 'text',
    value: 'Usage: ur knowledge add|remove|build|search|list|prune|status [...] [--json]',
  }
}
