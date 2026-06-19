import type { LocalCommandCall } from '../../types/command.js'
import {
  buildCodeGraph,
  buildOrUpdateIndex,
  dependenciesOf,
  formatGraphStats,
  getEmbeddingModel,
  graphPath,
  graphSearch,
  impactOf,
  indexPath,
  loadGraph,
  loadIndex,
  searchCode,
  whereDefined,
} from '../../utils/codeIndex/index.js'
import { startCodeIndexWatcher } from '../../utils/codeIndex/watcher.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function graphCommand(
  tokens: string[],
  root: string,
  json: boolean,
  signal: AbortSignal,
): Promise<{ type: 'text'; value: string }> {
  const sub = tokens.filter(t => !t.startsWith('--') && t !== 'graph')[0] ?? 'stats'
  const arg = tokens.filter(t => !t.startsWith('--') && t !== 'graph' && t !== sub).join(' ')

  if (sub === 'build') {
    const graph = await buildCodeGraph({ root, signal })
    return {
      type: 'text',
      value: json ? JSON.stringify({ files: graph.files.length }, null, 2) : formatGraphStats(graph),
    }
  }

  const graph = loadGraph(root)
  if (!graph) {
    return {
      type: 'text',
      value: 'No code graph found. Build it first with `ur code-index graph build`.',
    }
  }

  if (sub === 'stats') {
    return { type: 'text', value: json ? JSON.stringify(graph, null, 2) : formatGraphStats(graph) }
  }

  if (sub === 'impact' || sub === 'deps') {
    if (!arg) return { type: 'text', value: `Usage: ur code-index graph ${sub} <file>` }
    const result = sub === 'impact' ? impactOf(graph, arg) : dependenciesOf(graph, arg)
    if (json) return { type: 'text', value: JSON.stringify({ file: arg, [sub]: result }, null, 2) }
    const label = sub === 'impact' ? 'Impacted by changes to' : 'Dependencies of'
    return {
      type: 'text',
      value: result.length
        ? `${label} ${arg} (${result.length}):\n${result.map(f => `  ${f}`).join('\n')}`
        : `${label} ${arg}: none (or file not in graph).`,
    }
  }

  if (sub === 'where') {
    if (!arg) return { type: 'text', value: 'Usage: ur code-index graph where <symbol>' }
    const files = whereDefined(graph, arg)
    if (json) return { type: 'text', value: JSON.stringify({ symbol: arg, files }, null, 2) }
    return {
      type: 'text',
      value: files.length
        ? `${arg} defined in:\n${files.map(f => `  ${f}`).join('\n')}`
        : `Symbol not found in graph: ${arg}`,
    }
  }

  if (sub === 'search') {
    if (!arg) return { type: 'text', value: 'Usage: ur code-index graph search <query>' }
    const hits = graphSearch(graph, arg)
    if (json) return { type: 'text', value: JSON.stringify({ hits }, null, 2) }
    return {
      type: 'text',
      value: hits.length
        ? hits.map(h => `  ${h.file}  (${h.reason}, score ${h.degree})`).join('\n')
        : 'No structural matches.',
    }
  }

  return {
    type: 'text',
    value: 'Usage: ur code-index graph build|stats|impact <file>|deps <file>|where <symbol>|search <query>',
  }
}

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const command = tokens.find(token => !token.startsWith('--')) ?? 'status'
  const root = getCwd()
  const signal = new AbortController().signal

  if (command === 'graph') {
    return graphCommand(tokens, root, json, signal)
  }

  if (command === 'build') {
    try {
      const { stats } = await buildOrUpdateIndex({ root, signal })
      let graphLine = ''
      if (tokens.includes('--graph')) {
        const graph = await buildCodeGraph({ root, signal })
        graphLine = `\n  graph:    ${graph.files.length} files at ${graphPath(root)}`
      }
      if (json) {
        return { type: 'text', value: JSON.stringify(stats, null, 2) }
      }
      return {
        type: 'text',
        value:
          `Built code index at ${indexPath(root)}\n` +
          `  model:    ${stats.model} (dim ${stats.dim})\n` +
          `  files:    ${stats.filesIndexed} indexed, ${stats.filesSkipped} skipped, ${stats.filesRemoved} removed\n` +
          `  chunks:   ${stats.chunksTotal} total, ${stats.chunksEmbedded} (re)embedded\n` +
          `  ${stats.reused ? 'incremental update' : 'full build'}` +
          graphLine,
      }
    } catch (error) {
      return {
        type: 'text',
        value:
          `Failed to build code index: ${errorText(error)}\n` +
          `Tip: make sure the local Ollama app is running and the embedding model is pulled ` +
          `(e.g. \`ollama pull ${getEmbeddingModel()}\`).`,
      }
    }
  }

  if (command === 'watch') {
    if (tokens.includes('--dry-run')) {
      return {
        type: 'text',
        value: json
          ? JSON.stringify({ watching: root, graph: tokens.includes('--graph'), dryRun: true }, null, 2)
          : `Would watch ${root} and refresh the local code index on source changes.`,
      }
    }
    const handle = startCodeIndexWatcher({
      root,
      graph: tokens.includes('--graph'),
      onStatus: message => process.stderr.write(`${message}\n`),
      onError: message => process.stderr.write(`code-index watcher error: ${message}\n`),
    })
    process.stderr.write(`Watching ${root} for code-index changes. Press Ctrl+C to stop.\n`)
    await new Promise<void>(resolve => {
      const stop = (): void => {
        void handle.close().then(resolve)
      }
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
    })
    return { type: 'text', value: 'Stopped code-index watcher.' }
  }

  if (command === 'status') {
    const index = await loadIndex(root)
    const status = index
      ? {
          builtAt: index.builtAt,
          model: index.model,
          dim: index.dim,
          files: Object.keys(index.files).length,
          chunks: Object.keys(index.chunks).length,
          path: indexPath(root),
        }
      : { missing: true, path: indexPath(root), model: getEmbeddingModel() }
    return { type: 'text', value: JSON.stringify(status, null, 2) }
  }

  if (command === 'search') {
    const query = tokens
      .filter(token => !token.startsWith('--') && token !== 'search')
      .join(' ')
    if (!query) {
      return { type: 'text', value: 'Usage: ur code-index search <query> [--json]' }
    }
    try {
      const { hits, index } = await searchCode({ root, query, signal })
      if (!index) {
        return {
          type: 'text',
          value: 'No code index found. Build it first with `ur code-index build`.',
        }
      }
      if (json) {
        return { type: 'text', value: JSON.stringify({ hits }, null, 2) }
      }
      if (hits.length === 0) {
        return { type: 'text', value: 'No semantically similar code found.' }
      }
      return {
        type: 'text',
        value: hits
          .map(
            hit =>
              `${hit.file}:${hit.startLine}-${hit.endLine} (score ${hit.score.toFixed(3)})\n${hit.preview}`,
          )
          .join('\n\n'),
      }
    } catch (error) {
      return {
        type: 'text',
        value:
          `Code search failed: ${errorText(error)}\n` +
          `Tip: ensure the local Ollama app is running and "${getEmbeddingModel()}" is pulled.`,
      }
    }
  }

  return {
    type: 'text',
    value:
      'Usage: ur code-index build [--graph] | search <query> | status | ' +
      'watch [--graph] | graph build|impact <file>|deps <file>|where <symbol>|search <query> [--json]',
  }
}
