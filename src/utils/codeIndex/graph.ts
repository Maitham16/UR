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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { posix, resolve } from 'node:path'
import { join } from 'node:path'
import { safeParseJSON } from '../../utils/json.js'
import { listIndexableFiles } from './indexer.js'

export type CodeGraph = {
  version: 1
  builtAt: string
  files: string[]
  /** file -> internal files it imports. */
  imports: Record<string, string[]>
  /** file -> internal files that import it (reverse of `imports`). */
  importedBy: Record<string, string[]>
  /** exported/top-level symbol name -> files that define it. */
  symbols: Record<string, string[]>
}

const SRC_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs', '.py']

const IMPORT_RES = [
  /\bimport\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bexport\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  /^\s*from\s+([.\w]+)\s+import\b/gm,
  /^\s*import\s+([.\w]+)/gm,
]

const SYMBOL_RES = [
  /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
  /\bexport\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g,
  /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  /\bexport\s+(?:type|interface|enum)\s+([A-Za-z_$][\w$]*)/g,
  /\bexport\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
  /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
  /^\s*class\s+([A-Za-z_$][\w$]*)/gm,
  /^\s*def\s+([A-Za-z_][\w]*)/gm,
  /^\s*class\s+([A-Za-z_][\w]*)\s*[:(]/gm,
]

function matchAll(text: string, regexes: RegExp[]): string[] {
  const out: string[] = []
  for (const re of regexes) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      if (m[1]) out.push(m[1])
    }
  }
  return out
}

export function extractImports(content: string): string[] {
  return [...new Set(matchAll(content, IMPORT_RES))]
}

export function extractSymbols(content: string): string[] {
  return [...new Set(matchAll(content, SYMBOL_RES))]
}

/** Candidate file paths for an import target path (handles .js→.ts, index, ext-less). */
function candidates(targetNoExt: string): string[] {
  const list: string[] = []
  for (const ext of SRC_EXT) list.push(`${targetNoExt}${ext}`)
  for (const ext of SRC_EXT) list.push(posix.join(targetNoExt, `index${ext}`))
  return list
}

/** Resolve an import specifier to an internal repo file, or null if external. Pure. */
export function resolveImport(
  fromFile: string,
  spec: string,
  fileSet: Set<string>,
): string | null {
  let rel: string | null = null
  if (spec.startsWith('.') && /[\\/]/.test(spec)) {
    // JS/TS relative path import.
    rel = posix.normalize(posix.join(posix.dirname(fromFile), spec))
  } else if (spec.startsWith('.')) {
    // Python relative import: leading dots = parent levels, rest = path segments.
    const dots = spec.match(/^\.+/)?.[0].length ?? 1
    const rest = spec.slice(dots).replace(/\./g, '/')
    let base = posix.dirname(fromFile)
    for (let i = 1; i < dots; i++) base = posix.dirname(base)
    rel = posix.normalize(posix.join(base, rest))
  } else {
    return null // bare/external specifier
  }
  if (fileSet.has(rel)) return rel
  const noExt = rel.replace(/\.(?:m|c)?[jt]sx?$/, '').replace(/\.py$/, '')
  for (const candidate of candidates(noExt)) {
    if (fileSet.has(candidate)) return candidate
  }
  return null
}

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
  const rels = (await listIndexableFiles(options.root, signal)).slice(
    0,
    options.maxFiles ?? 5000,
  )
  const sources: SourceFile[] = []
  for (const rel of rels) {
    try {
      sources.push({ path: rel, content: read(resolve(options.root, rel)) })
    } catch {
      // unreadable file — skip
    }
  }
  const graph = buildGraphFromFiles(sources)
  mkdirSync(join(options.root, '.ur', 'code-index'), { recursive: true })
  writeFileSync(graphPath(options.root), `${JSON.stringify(graph, null, 2)}\n`)
  return graph
}

export function loadGraph(root: string): CodeGraph | null {
  const path = graphPath(root)
  if (!existsSync(path)) return null
  const parsed = safeParseJSON(readFileSync(path, 'utf-8'), false)
  return parsed && typeof parsed === 'object' ? (parsed as CodeGraph) : null
}

export function formatGraphStats(graph: CodeGraph): string {
  const edges = Object.values(graph.imports).reduce((sum, list) => sum + list.length, 0)
  const symbols = Object.keys(graph.symbols).length
  return [
    `Code graph (${graph.builtAt})`,
    `  files:   ${graph.files.length}`,
    `  imports: ${edges} internal edges`,
    `  symbols: ${symbols}`,
  ].join('\n')
}
