/**
 * Local code knowledge graph (structural retrieval / GraphRAG).
 *
 * The semantic index finds code by meaning; this finds it by structure. It
 * builds an import/symbol graph over the repo so UR can answer "what imports
 * this?" (blast radius / impact analysis), "what does this depend on?", and
 * "where is this symbol defined?", and can expand a semantic hit to its
 * structural neighbors. Extraction and graph queries are pure functions over
 * file contents, so they unit-test offline with no Ollama and no embeddings.
 * Stored next to the semantic index under `.ur/code-index/graph.json`.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { join } from 'node:path'
import { safeParseJSON } from '../../utils/json.js'
import { listIndexableFiles } from './indexer.js'
import { sha1 } from './store.js'
import type { IndexCoverage } from './types.js'
import { writeIndexJson } from './snapshot.js'

export type CodeGraph = {
  version: 1
  builtAt: string
  files: string[]
  hashes?: Record<string, string>
  coverage?: IndexCoverage
  staleFiles?: string[]
  /** file -> internal files it imports. */
  imports: Record<string, string[]>
  /** file -> internal files that import it (reverse of `imports`). */
  importedBy: Record<string, string[]>
  /** exported/top-level symbol name -> files that define it. */
  symbols: Record<string, string[]>
}

export { extractImports, extractSymbols, resolveImport } from './structure.js'
import { extractImports, extractSymbols, resolveImport } from './structure.js'

export type SourceFile = { path: string; content: string }

/** Build the graph from in-memory files. Pure and deterministic. */
export function buildGraphFromFiles(sources: SourceFile[]): CodeGraph {
  const files = sources.map(s => s.path).sort()
  const fileSet = new Set(files)
  const imports: Record<string, string[]> = {}
  const importedBy: Record<string, string[]> = {}
  const symbols: Record<string, string[]> = {}

  for (const file of files) importedBy[file] = []

  for (const source of sources) {
    const resolved = new Set<string>()
    for (const spec of extractImports(source.content)) {
      const target = resolveImport(source.path, spec, fileSet)
      if (target && target !== source.path) resolved.add(target)
    }
    imports[source.path] = [...resolved].sort()
    for (const target of resolved) {
      ;(importedBy[target] ??= []).push(source.path)
    }
    for (const symbol of extractSymbols(source.content)) {
      ;(symbols[symbol] ??= []).push(source.path)
    }
  }
  for (const file of files) importedBy[file] = [...new Set(importedBy[file])].sort()
  for (const symbol of Object.keys(symbols)) {
    symbols[symbol] = [...new Set(symbols[symbol])].sort()
  }

  return {
    version: 1,
    builtAt: new Date().toISOString(),
    files,
    hashes: Object.fromEntries(sources.map(source => [source.path, sha1(source.content)])),
    imports,
    importedBy,
    symbols,
  }
}

function transitive(
  start: string,
  edges: Record<string, string[]>,
  maxDepth = Number.POSITIVE_INFINITY,
): string[] {
  const seen = new Set<string>()
  let frontier = [start]
  let depth = 0
  while (frontier.length > 0 && depth < maxDepth) {
    const next: string[] = []
    for (const node of frontier) {
      for (const neighbor of edges[node] ?? []) {
        if (neighbor !== start && !seen.has(neighbor)) {
          seen.add(neighbor)
          next.push(neighbor)
        }
      }
    }
    frontier = next
    depth += 1
  }
  return [...seen].sort()
}

/** Files that (transitively) import `file` — the blast radius of changing it. */
export function impactOf(graph: CodeGraph, file: string, maxDepth?: number): string[] {
  return transitive(file, graph.importedBy, maxDepth)
}

/** Files that `file` (transitively) depends on. */
export function dependenciesOf(graph: CodeGraph, file: string, maxDepth?: number): string[] {
  return transitive(file, graph.imports, maxDepth)
}

export function whereDefined(graph: CodeGraph, symbol: string): string[] {
  return graph.symbols[symbol] ?? []
}

export type GraphHit = { file: string; reason: string; degree: number }

/**
 * Graph-augmented retrieval: match the query to symbols, then expand to the
 * one-hop structural neighborhood (imports + importers) of the defining files.
 */
export function graphSearch(graph: CodeGraph, query: string, limit = 15): GraphHit[] {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9_$]+/)
    .filter(t => t.length >= 3)
  if (tokens.length === 0) return []
  const scored = new Map<string, GraphHit>()
  const bump = (file: string, reason: string, weight: number) => {
    const existing = scored.get(file)
    if (existing) existing.degree += weight
    else scored.set(file, { file, reason, degree: weight })
  }
  for (const [symbol, files] of Object.entries(graph.symbols)) {
    const lower = symbol.toLowerCase()
    if (!tokens.some(t => lower.includes(t))) continue
    for (const file of files) {
      bump(file, `defines ${symbol}`, 5)
      for (const neighbor of graph.imports[file] ?? []) bump(neighbor, `imported by match`, 1)
      for (const neighbor of graph.importedBy[file] ?? []) bump(neighbor, `imports match`, 1)
    }
  }
  return [...scored.values()].sort((a, b) => b.degree - a.degree).slice(0, limit)
}

export function graphPath(root: string): string {
  return join(root, '.ur', 'code-index', 'graph.json')
}

export type BuildGraphOptions = {
  root: string
  signal?: AbortSignal
  readFile?: (absPath: string) => string
  maxFiles?: number
}

/** Build the graph from the repo and persist it. */
export async function buildCodeGraph(options: BuildGraphOptions): Promise<CodeGraph> {
  const signal = options.signal ?? new AbortController().signal
  const read = options.readFile ?? ((abs: string) => readFileSync(abs, 'utf-8'))
  const candidates = await listIndexableFiles(options.root, signal)
  const rels = candidates.slice(0, options.maxFiles)
  const skipped: IndexCoverage['skipped'] = []
  const sources: SourceFile[] = []
  for (const rel of rels) {
    signal.throwIfAborted()
    try {
      sources.push({ path: rel, content: read(resolve(options.root, rel)) })
    } catch {
      skipped.push({ file: rel, reason: "Unreadable source" })
    }
  }
  const graph = buildGraphFromFiles(sources)
  graph.coverage = { candidates: candidates.length, indexed: sources.length, omittedByLimit: candidates.length - rels.length, skipped, truncatedFiles: [], maxFiles: options.maxFiles ?? null, complete: candidates.length === sources.length }
  mkdirSync(join(options.root, '.ur', 'code-index'), { recursive: true })
  writeIndexJson(graphPath(options.root), graph)
  return graph
}

export function loadGraph(root: string): CodeGraph | null {
  const path = graphPath(root)
  if (!existsSync(path)) return null
  const parsed = safeParseJSON(readFileSync(path, 'utf-8'), false)
  if (!parsed || typeof parsed !== 'object') return null
  const graph = structuredClone(parsed) as CodeGraph
  if (!Array.isArray(graph.files) || !graph.hashes || !graph.imports || !graph.importedBy || !graph.symbols) return null
  const current = new Set(graph.files.filter(file => {
    try { return sha1(readFileSync(resolve(root, file), 'utf8')) === graph.hashes![file] } catch { return false }
  }))
  graph.staleFiles = graph.files.filter(file => !current.has(file))
  graph.files = graph.files.filter(file => current.has(file))
  for (const edges of [graph.imports, graph.importedBy]) for (const file of Object.keys(edges)) {
    if (!current.has(file)) delete edges[file]
    else edges[file] = edges[file]!.filter(target => current.has(target))
  }
  for (const symbol of Object.keys(graph.symbols)) graph.symbols[symbol] = graph.symbols[symbol]!.filter(file => current.has(file))
  return graph
}

export function formatGraphStats(graph: CodeGraph): string {
  const edges = Object.values(graph.imports).reduce((sum, list) => sum + list.length, 0)
  const symbols = Object.keys(graph.symbols).length
  return [
    `Code graph (${graph.builtAt})`,
    `  files:   ${graph.files.length}`,
    `  imports: ${edges} internal edges`,
    `  symbols: ${symbols}`,
    `  coverage: ${graph.coverage ? `${graph.coverage.indexed}/${graph.coverage.candidates} candidates; ${graph.coverage.omittedByLimit} omitted by limit; ${graph.coverage.skipped.length} skipped` : 'unknown (rebuild to measure)'}`,
    `  stale sources excluded: ${graph.staleFiles?.length ?? 0}`,
  ].join('\n')
}
