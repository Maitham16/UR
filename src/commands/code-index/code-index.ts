import type { LocalCommandCall } from '../../types/command.js'
import {
  buildCodeGraph,
  buildOrUpdateIndex,
  buildRepoIndex,
  dependenciesOf,
  docSearch,
  findCallers,
  findTestsForFile,
  formatGraphStats,
  formatRepoStats,
  getEmbeddingModel,
  graphPath,
  graphSearch,
  impactOf,
  indexPath,
  loadCallIndex,
  loadConfigIndex,
  loadDocIndex,
  loadGraph,
  loadIndex,
  loadRepoIndex,
  loadSymbolIndex,
  loadTestIndex,
  repoIndexPath,
  repoSearch,
  searchCode,
  symbolSearch,
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

async function repoCommand(
  tokens: string[],
  root: string,
  json: boolean,
  signal: AbortSignal,
): Promise<{ type: 'text'; value: string }> {
  const sub = tokens.filter(t => !t.startsWith('--') && t !== 'repo')[0] ?? 'status'
  const arg = tokens.filter(t => !t.startsWith('--') && t !== 'repo' && t !== sub).join(' ')

  if (sub === 'build') {
    const { repo } = await buildRepoIndex({ root, signal })
    return {
      type: 'text',
      value: json
        ? JSON.stringify({ files: repo.files.length, path: repoIndexPath(root) }, null, 2)
        : `Built repo index at ${repoIndexPath(root)}\n${formatRepoStats(repo)}`,
    }
  }

  const repo = loadRepoIndex(root)
  if (!repo) {
    return {
      type: 'text',
      value: 'No repo index found. Build it first with `ur code-index repo build`.',
    }
  }

  if (sub === 'status') {
    return {
      type: 'text',
      value: json
        ? JSON.stringify(
            {
              builtAt: repo.builtAt,
              files: repo.files.length,
              path: repoIndexPath(root),
            },
            null,
            2,
          )
        : formatRepoStats(repo),
    }
  }

  if (sub === 'search') {
    if (!arg) return { type: 'text', value: 'Usage: ur code-index repo search <query>' }
    const hits = repoSearch(repo, arg)
    if (json) return { type: 'text', value: JSON.stringify({ hits }, null, 2) }
    return {
      type: 'text',
      value: hits.length
        ? hits.map(h => `  ${h.path} (${h.kind})${h.symbols ? ` [${h.symbols.slice(0, 5).join(', ')}${h.symbols.length > 5 ? '...' : ''}]` : ''}`).join('\n')
        : 'No repo matches.',
    }
  }

  if (sub === 'symbols') {
    if (!arg) return { type: 'text', value: 'Usage: ur code-index repo symbols <query>' }
    const symbols = loadSymbolIndex(root)
    if (!symbols) return { type: 'text', value: 'No symbol index found.' }
    const hits = symbolSearch(symbols, arg)
    if (json) return { type: 'text', value: JSON.stringify({ hits }, null, 2) }
    return {
      type: 'text',
      value: hits.length
        ? hits.map(s => `  ${s.name} (${s.kind}) ${s.file}${s.line ? `:${s.line}` : ''}`).join('\n')
        : 'No symbol matches.',
    }
  }

  if (sub === 'callers') {
    if (!arg) return { type: 'text', value: 'Usage: ur code-index repo callers <symbol>' }
    const calls = loadCallIndex(root)
    if (!calls) return { type: 'text', value: 'No call index found.' }
    const hits = findCallers(calls, arg)
    if (json) return { type: 'text', value: JSON.stringify({ hits }, null, 2) }
    return {
      type: 'text',
      value: hits.length
        ? hits.map(c => `  ${c.caller} -> ${c.callee} in ${c.file}${c.line ? `:${c.line}` : ''}`).join('\n')
        : `No callers found for ${arg}.`,
    }
  }

  if (sub === 'tests') {
    if (!arg) return { type: 'text', value: 'Usage: ur code-index repo tests <file>' }
    const tests = loadTestIndex(root)
    if (!tests) return { type: 'text', value: 'No test index found.' }
    const hits = findTestsForFile(tests, arg)
    if (json) return { type: 'text', value: JSON.stringify({ hits }, null, 2) }
    return {
      type: 'text',
      value: hits.length
        ? hits.map(t => `  ${t.file}${t.name ? ` — ${t.name}` : ''}`).join('\n')
        : `No tests found for ${arg}.`,
    }
  }

  if (sub === 'docs') {
    if (!arg) return { type: 'text', value: 'Usage: ur code-index repo docs <query>' }
    const docs = loadDocIndex(root)
    if (!docs) return { type: 'text', value: 'No doc index found.' }
    const hits = docSearch(docs, arg)
    if (json) return { type: 'text', value: JSON.stringify({ hits }, null, 2) }
    return {
      type: 'text',
      value: hits.length
        ? hits.map(d => `  ${d.path}${d.title ? ` — ${d.title}` : ''}`).join('\n')
        : 'No doc matches.',
    }
  }

  if (sub === 'configs') {
    if (!arg) return { type: 'text', value: 'Usage: ur code-index repo configs <query>' }
    const configs = loadConfigIndex(root)
    if (!configs) return { type: 'text', value: 'No config index found.' }
    const q = arg.toLowerCase()
    const hits = configs.configs.filter(
      c =>
        c.path.toLowerCase().includes(q) ||
        c.kind.toLowerCase().includes(q) ||
        c.keys?.some(k => k.toLowerCase().includes(q)),
    )
    if (json) return { type: 'text', value: JSON.stringify({ hits }, null, 2) }
    return {
      type: 'text',
      value: hits.length
        ? hits.map(c => `  ${c.path} (${c.kind})${c.keys ? ` [${c.keys.slice(0, 5).join(', ')}${c.keys.length > 5 ? '...' : ''}]` : ''}`).join('\n')
        : 'No config matches.',
    }
  }

  return {
    type: 'text',
    value:
      'Usage: ur code-index repo build|status|search <query>|symbols <query>|callers <symbol>|tests <file>|docs <query>|configs <query> [--json]',
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

  if (command === 'repo') {
    return repoCommand(tokens, root, json, signal)
  }

  if (command === 'build') {
    try {
      const { stats } = await buildOrUpdateIndex({ root, signal })
      let graphLine = ''
      if (tokens.includes('--graph')) {
        const graph = await buildCodeGraph({ root, signal })
        graphLine = `\n  graph:    ${graph.files.length} files at ${graphPath(root)}`
      }
      let repoLine = ''
      if (tokens.includes('--repo')) {
        const repoStats = await buildRepoIndex({ root, signal })
        repoLine = `\n  repo:     ${repoStats.repo.files.length} files, ${repoStats.symbols.symbols.length} symbols at ${repoIndexPath(root)}`
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
          graphLine +
          repoLine,
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
      repo: tokens.includes('--repo'),
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
      'Usage: ur code-index build [--graph] [--repo] | search <query> | status | ' +
      'watch [--graph] [--repo] | graph build|impact <file>|deps <file>|where <symbol>|search <query> | ' +
      'repo build|status|search <query>|symbols <query>|callers <symbol>|tests <file>|docs <query>|configs <query> [--json]',
  }
}
