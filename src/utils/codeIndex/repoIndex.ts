/**
 * Semantic repo index: files, symbols, imports, call graph, tests, docs, configs.
 *
 * Builds offline, dependency-free JSON indexes next to the embedding index:
 *   .ur/code-index/repo.json     — file classification + imports/importedBy
 *   .ur/code-index/symbols.json  — symbol definitions
 *   .ur/code-index/calls.json    — caller -> callee edges
 *   .ur/code-index/tests.json    — test file mapping
 *   .ur/code-index/docs.json     — README/docs references
 *   .ur/code-index/configs.json — config file metadata
 *
 * Extraction is regex/heuristic based (consistent with graph.ts). An optional
 * TypeScript compiler API pass improves accuracy for TS/JS repos when available.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { safeParseJSON } from '../json.js'
import { listIndexableFiles } from './indexer.js'
import type { IndexCoverage } from './types.js'
import { writeIndexJson } from './snapshot.js'

export type RepoIndex = {
  version: 1
  builtAt: string
  root: string
  files: RepoFileEntry[]
  coverage?: IndexCoverage
  staleFiles?: string[]
}

export type RepoFileEntry = {
  path: string
  kind: 'source' | 'test' | 'doc' | 'config' | 'other'
  language?: string
  hash: string
  symbols?: string[]
  imports?: string[]
  importedBy?: string[]
}

export type SymbolIndex = {
  version: 1
  builtAt: string
  symbols: SymbolEntry[]
}

export type SymbolEntry = {
  name: string
  kind: 'function' | 'class' | 'type' | 'interface' | 'variable' | 'module'
  file: string
  line?: number
  column?: number
  references?: { file: string; line: number }[]
}

export type CallGraphIndex = {
  version: 1
  builtAt: string
  calls: CallEntry[]
}

export type CallEntry = {
  caller: string
  callee: string
  file: string
  line?: number
}

export type TestIndex = {
  version: 1
  builtAt: string
  tests: TestEntry[]
}

export type TestEntry = {
  file: string
  name?: string
  kind: string
}

export type DocIndex = {
  version: 1
  builtAt: string
  docs: DocEntry[]
}

export type DocEntry = {
  path: string
  title?: string
  refs: string[]
}

export type ConfigIndex = {
  version: 1
  builtAt: string
  configs: ConfigEntry[]
}

export type ConfigEntry = {
  path: string
  kind: string
  keys?: string[]
}

const SRC_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
  '.py', '.pyi', '.rb', '.go', '.rs', '.java', '.kt', '.kts',
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hpp', '.cs', '.swift',
  '.php', '.lua', '.dart', '.ex', '.exs', '.erl', '.clj', '.hs',
  '.sh', '.bash', '.zsh', '.sql', '.vue', '.svelte', '.astro',
])

const TEST_SEGMENTS = [
  /[\._-](?:test|spec)\.[mc]?[jt]sx?$/i,
  /[\/_](?:tests?|__tests__|specs?)\//i,
  /\.(?:test|spec)\.(py|rb|go|rs|java|kt|swift|php)$/i,
]

const CONFIG_NAMES = new Set([
  'package.json', 'bunfig.toml', 'tsconfig.json', 'jsconfig.json',
  'vite.config.ts', 'vite.config.js', 'webpack.config.js', 'rollup.config.js',
  'eslint.config.js', 'eslint.config.mjs', 'eslint.config.ts', '.eslintrc.json',
  '.prettierrc', 'prettier.config.js', 'prettier.config.mjs',
  'tailwind.config.js', 'tailwind.config.ts', 'next.config.js', 'next.config.mjs',
  'jest.config.js', 'jest.config.ts', 'vitest.config.ts', 'vitest.config.js',
  'dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
  'Makefile', 'makefile', 'CMakeLists.txt',
  '.github/workflows', '.ur', 'AGENTS.md', 'UR.md', 'UR.local.md',
])

const CONFIG_EXTENSIONS = new Set([
  '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.lock',
  '.config', '.conf',
])

const IMPORT_RES = [
  /\bimport\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bexport\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  /^\s*from\s+([.\w]+)\s+import\b/gm,
  /^\s*import\s+([.\w]+)/gm,
]

const SYMBOL_RES: Array<{ re: RegExp; kind: SymbolEntry['kind'] }> = [
  { re: /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g, kind: 'function' },
  { re: /\bexport\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g, kind: 'class' },
  { re: /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g, kind: 'variable' },
  { re: /\bexport\s+(?:type|interface|enum)\s+([A-Za-z_$][\w$]*)/g, kind: 'type' },
  { re: /\bexport\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g, kind: 'function' },
  { re: /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm, kind: 'function' },
  { re: /^\s*class\s+([A-Za-z_$][\w$]*)/gm, kind: 'class' },
  { re: /^\s*def\s+([A-Za-z_][\w]*)/gm, kind: 'function' },
  { re: /^\s*class\s+([A-Za-z_][\w]*)\s*[:(]/gm, kind: 'class' },
]

const CALL_RE = /\b([A-Za-z_$][\w$]*)\s*\(/g

const TEST_RE = /\b(?:it|test|describe)\s*\(\s*['"`]([^'"`]+)['"`]/g

function sha1(content: string): string {
  return createHash('sha1').update(content).digest('hex')
}

function posixExt(file: string): string {
  const dot = file.lastIndexOf('.')
  return dot < 0 ? '' : file.slice(dot).toLowerCase()
}

function languageFromExt(ext: string): string | undefined {
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'jsx',
    '.mjs': 'javascript', '.cjs': 'javascript', '.mts': 'typescript', '.cts': 'typescript',
    '.py': 'python', '.pyi': 'python', '.rb': 'ruby', '.go': 'go', '.rs': 'rust',
    '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin', '.swift': 'swift',
    '.c': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp', '.cs': 'csharp',
    '.php': 'php', '.lua': 'lua', '.sh': 'bash', '.bash': 'bash', '.zsh': 'zsh',
    '.sql': 'sql', '.vue': 'vue', '.svelte': 'svelte', '.astro': 'astro',
  }
  return map[ext]
}

function isTestFile(path: string): boolean {
  return TEST_SEGMENTS.some(re => re.test(path))
}

function isDocFile(path: string, ext: string): boolean {
  return ext === '.md' || ext === '.mdx' || ext === '.rst' || ext === '.adoc' || ext === '.txt'
}

function isConfigFile(path: string, ext: string): boolean {
  const basename = path.split('/').pop() ?? ''
  if (CONFIG_NAMES.has(basename)) return true
  if (CONFIG_NAMES.has(path)) return true
  if (CONFIG_EXTENSIONS.has(ext)) return true
  if (basename.startsWith('.') && ext === '') return true
  return false
}

function fileKind(path: string, ext: string): RepoFileEntry['kind'] {
  if (isTestFile(path)) return 'test'
  if (isDocFile(path, ext)) return 'doc'
  if (isConfigFile(path, ext)) return 'config'
  if (SRC_EXTENSIONS.has(ext)) return 'source'
  return 'other'
}

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

function extractImports(content: string): string[] {
  return [...new Set(matchAll(content, IMPORT_RES))]
}

function extractSymbolsDetailed(content: string): SymbolEntry[] {
  const out: SymbolEntry[] = []
  const lines = content.split('\n')
  for (const { re, kind } of SYMBOL_RES) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) {
      const name = m[1]
      if (!name) continue
      const line = content.slice(0, m.index).split('\n').length
      const column = m.index - content.lastIndexOf('\n', m.index)
      out.push({ name, kind, file: '', line, column })
    }
  }
  return out
}

function extractCalls(content: string, localSymbols: Set<string>): CallEntry[] {
  const calls: CallEntry[] = []
  const seen = new Set<string>()
  CALL_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CALL_RE.exec(content)) !== null) {
    const callee = m[1]
    if (!callee || !localSymbols.has(callee)) continue
    const key = `${callee}:${m.index}`
    if (seen.has(key)) continue
    seen.add(key)
    const line = content.slice(0, m.index).split('\n').length
    calls.push({ caller: '', callee, file: '', line })
  }
  return calls
}

function extractTests(path: string, content: string): TestEntry[] {
  const ext = posixExt(path)
  if (!isTestFile(path) && ext !== '.ts' && ext !== '.tsx' && ext !== '.js' && ext !== '.jsx') {
    return []
  }
  const tests: TestEntry[] = []
  TEST_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TEST_RE.exec(content)) !== null) {
    tests.push({ file: path, name: m[1], kind: 'test' })
  }
  if (tests.length === 0 && isTestFile(path)) {
    tests.push({ file: path, kind: 'test-file' })
  }
  return tests
}

function extractDocRefs(path: string, content: string): string[] {
  const refs: string[] = []
  const re = /\]\(([^)]+)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    const ref = m[1]
    if (ref && !ref.startsWith('http') && !ref.startsWith('#')) {
      refs.push(ref.replace(/^\.\//, ''))
    }
  }
  return [...new Set(refs)]
}

function extractDocTitle(content: string): string | undefined {
  const m = content.match(/^#\s+(.+)$/m)
  return m?.[1]?.trim()
}

function extractConfigKeys(path: string, content: string): string[] | undefined {
  const ext = posixExt(path)
  if (ext === '.json') {
    try {
      const parsed = JSON.parse(content)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return Object.keys(parsed).slice(0, 100)
      }
    } catch {
      // ignore
    }
  }
  return undefined
}

function configKind(path: string, ext: string): string {
  const basename = path.split('/').pop() ?? ''
  if (basename === 'package.json') return 'package'
  if (basename.startsWith('tsconfig')) return 'typescript'
  if (basename.startsWith('eslint')) return 'eslint'
  if (basename.startsWith('jest') || basename.startsWith('vitest')) return 'test'
  if (basename.startsWith('vite') || basename.startsWith('webpack') || basename.startsWith('rollup')) return 'build'
  if (basename === 'Dockerfile' || basename.startsWith('docker-compose')) return 'docker'
  if (basename === 'Makefile' || basename === 'CMakeLists.txt') return 'build'
  if (basename === 'UR.md' || basename === 'AGENTS.md' || basename === 'UR.local.md') return 'instructions'
  if (ext === '.json' || ext === '.yaml' || ext === '.yml' || ext === '.toml') return 'config'
  return 'config'
}

function resolveImport(fromFile: string, spec: string, fileSet: Set<string>): string | null {
  if (!spec.startsWith('.')) return null
  const dir = posix.normalize(fromFile).split('/').slice(0, -1).join('/')
  let rel = posix.normalize(`${dir}/${spec}`)
  if (rel.startsWith('/')) rel = rel.slice(1)
  if (fileSet.has(rel)) return rel
  const noExt = rel.replace(/\.(?:m|c)?[jt]sx?$/, '').replace(/\.py$/, '')
  for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs', '.py']) {
    if (fileSet.has(`${noExt}${ext}`)) return `${noExt}${ext}`
    if (fileSet.has(`${noExt}/index${ext}`)) return `${noExt}/index${ext}`
  }
  return null
}

export type BuildRepoIndexOptions = {
  root: string
  signal?: AbortSignal
  maxFiles?: number
  readFile?: (absPath: string) => string
}

/** Build all repo indexes. */
export async function buildRepoIndex(options: BuildRepoIndexOptions): Promise<{
  repo: RepoIndex
  symbols: SymbolIndex
  calls: CallGraphIndex
  tests: TestIndex
  docs: DocIndex
  configs: ConfigIndex
}> {
  const signal = options.signal ?? new AbortController().signal
  const read = options.readFile ?? ((abs: string) => readFileSync(abs, 'utf-8'))
  const candidates = await listIndexableFiles(options.root, signal)
  const rels = candidates.slice(0, options.maxFiles)
  const skipped: IndexCoverage['skipped'] = []
  const fileSet = new Set(rels)

  const files: RepoFileEntry[] = []
  const symbolEntries: SymbolEntry[] = []
  const callEntries: CallEntry[] = []
  const testEntries: TestEntry[] = []
  const docEntries: DocEntry[] = []
  const configEntries: ConfigEntry[] = []

  for (const rel of rels) {
    signal.throwIfAborted()
    const abs = join(options.root, rel)
    let content: string
    try {
      content = read(abs)
    } catch {
      skipped.push({ file: rel, reason: "Unreadable source" })
      continue
    }
    const ext = posixExt(rel)
    const hash = sha1(content)
    const kind = fileKind(rel, ext)
    const language = languageFromExt(ext)

    const imports = extractImports(content)
      .map(spec => resolveImport(rel, spec, fileSet))
      .filter((s): s is string => Boolean(s))
    const importedBy: string[] = []

    const fileSymbols = extractSymbolsDetailed(content)
    const localSymbolNames = new Set(fileSymbols.map(s => s.name))
    const fileCalls = extractCalls(content, localSymbolNames)

    for (const s of fileSymbols) {
      s.file = rel
      symbolEntries.push(s)
    }

    // Determine the likely enclosing top-level symbol for each call.
    const fileSymbolRanges = fileSymbols
      .map(s => {
        const idx = content.indexOf(s.name, 0)
        return { name: s.name, start: idx }
      })
      .filter((s): s is { name: string; start: number } => s.start >= 0)
      .sort((a, b) => a.start - b.start)

    function callerAt(index: number): string | undefined {
      let last: { name: string; start: number } | undefined
      for (const sym of fileSymbolRanges) {
        if (sym.start > index) break
        last = sym
      }
      return last?.name
    }

    for (const c of fileCalls) {
      c.file = rel
      // Search from the call index backwards for the enclosing symbol.
      const callIndex = content.lastIndexOf(`${c.callee}(`, c.line ? content.split('\n').slice(0, c.line - 1).join('\n').length : content.length)
      c.caller = callerAt(callIndex) ?? ''
      callEntries.push(c)
    }

    files.push({
      path: rel,
      kind,
      language,
      hash,
      symbols: [...new Set(fileSymbols.map(s => s.name))].sort(),
      imports: [...new Set(imports)].sort(),
      importedBy,
    })

    if (isTestFile(rel) || kind === 'test') {
      testEntries.push(...extractTests(rel, content))
    }

    if (kind === 'doc') {
      docEntries.push({
        path: rel,
        title: extractDocTitle(content),
        refs: extractDocRefs(rel, content),
      })
    }

    if (kind === 'config' || isConfigFile(rel, ext)) {
      configEntries.push({
        path: rel,
        kind: configKind(rel, ext),
        keys: extractConfigKeys(rel, content),
      })
    }
  }

  // Build importedBy reverse map.
  const byPath = new Map(files.map(f => [f.path, f]))
  for (const file of files) {
    for (const imp of file.imports ?? []) {
      const target = byPath.get(imp)
      if (target) {
        ;(target.importedBy ??= []).push(file.path)
      }
    }
  }
  for (const file of files) {
    file.importedBy = [...new Set(file.importedBy ?? [])].sort()
  }

  const now = new Date().toISOString()
  const repo: RepoIndex = { version: 1, builtAt: now, root: options.root, files, coverage: { candidates: candidates.length, indexed: files.length, omittedByLimit: candidates.length - rels.length, skipped, truncatedFiles: [], maxFiles: options.maxFiles ?? null, complete: candidates.length === files.length } }
  const symbols: SymbolIndex = { version: 1, builtAt: now, symbols: symbolEntries }
  const calls: CallGraphIndex = { version: 1, builtAt: now, calls: callEntries }
  const tests: TestIndex = { version: 1, builtAt: now, tests: testEntries }
  const docs: DocIndex = { version: 1, builtAt: now, docs: docEntries }
  const configs: ConfigIndex = { version: 1, builtAt: now, configs: configEntries }

  mkdirSync(repoIndexDir(options.root), { recursive: true })
  writeIndexJson(symbolIndexPath(options.root), symbols)
  writeIndexJson(callIndexPath(options.root), calls)
  writeIndexJson(testIndexPath(options.root), tests)
  writeIndexJson(docIndexPath(options.root), docs)
  writeIndexJson(configIndexPath(options.root), configs)
  // Commit manifest last. Readers reject artifacts from a different generation.
  writeIndexJson(repoIndexPath(options.root), repo)

  return { repo, symbols, calls, tests, docs, configs }
}

export function repoIndexDir(root: string): string {
  return join(root, '.ur', 'code-index')
}

export function repoIndexPath(root: string): string {
  return join(repoIndexDir(root), 'repo.json')
}

export function symbolIndexPath(root: string): string {
  return join(repoIndexDir(root), 'symbols.json')
}

export function callIndexPath(root: string): string {
  return join(repoIndexDir(root), 'calls.json')
}

export function testIndexPath(root: string): string {
  return join(repoIndexDir(root), 'tests.json')
}

export function docIndexPath(root: string): string {
  return join(repoIndexDir(root), 'docs.json')
}

export function configIndexPath(root: string): string {
  return join(repoIndexDir(root), 'configs.json')
}

export function loadRepoIndex(root: string): RepoIndex | null {
  const repo = loadJsonFile<RepoIndex>(repoIndexPath(root))
  if (!repo || !Array.isArray(repo.files)) return null
  const original = repo.files
  repo.files = original.filter(file => {
    try { return sha1(readFileSync(join(root, file.path), 'utf8')) === file.hash } catch { return false }
  })
  repo.staleFiles = original.filter(file => !repo.files.includes(file)).map(file => file.path)
  const current = new Set(repo.files.map(file => file.path))
  for (const file of repo.files) {
    file.imports = file.imports?.filter(path => current.has(path))
    file.importedBy = file.importedBy?.filter(path => current.has(path))
  }
  return repo
}

export function loadSymbolIndex(root: string): SymbolIndex | null {
  const repo = loadRepoIndex(root)
  const artifact = loadJsonFile<SymbolIndex>(symbolIndexPath(root))
  if (!repo || !artifact || artifact.builtAt !== repo.builtAt || !Array.isArray(artifact.symbols)) return null
  const current = new Set(repo.files.map(file => file.path))
  artifact.symbols = artifact.symbols.filter(entry => current.has(entry.file))
  return artifact
}

export function loadCallIndex(root: string): CallGraphIndex | null {
  const repo = loadRepoIndex(root)
  const artifact = loadJsonFile<CallGraphIndex>(callIndexPath(root))
  if (!repo || !artifact || artifact.builtAt !== repo.builtAt || !Array.isArray(artifact.calls)) return null
  const current = new Set(repo.files.map(file => file.path))
  artifact.calls = artifact.calls.filter(entry => current.has(entry.file))
  return artifact
}

export function loadTestIndex(root: string): TestIndex | null {
  const repo = loadRepoIndex(root)
  const artifact = loadJsonFile<TestIndex>(testIndexPath(root))
  if (!repo || !artifact || artifact.builtAt !== repo.builtAt || !Array.isArray(artifact.tests)) return null
  const current = new Set(repo.files.map(file => file.path))
  artifact.tests = artifact.tests.filter(entry => current.has(entry.file))
  return artifact
}

export function loadDocIndex(root: string): DocIndex | null {
  const repo = loadRepoIndex(root)
  const artifact = loadJsonFile<DocIndex>(docIndexPath(root))
  if (!repo || !artifact || artifact.builtAt !== repo.builtAt || !Array.isArray(artifact.docs)) return null
  const current = new Set(repo.files.map(file => file.path))
  artifact.docs = artifact.docs.filter(entry => current.has(entry.path))
  return artifact
}

export function loadConfigIndex(root: string): ConfigIndex | null {
  const repo = loadRepoIndex(root)
  const artifact = loadJsonFile<ConfigIndex>(configIndexPath(root))
  if (!repo || !artifact || artifact.builtAt !== repo.builtAt || !Array.isArray(artifact.configs)) return null
  const current = new Set(repo.files.map(file => file.path))
  artifact.configs = artifact.configs.filter(entry => current.has(entry.path))
  return artifact
}

function loadJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null
  const parsed = safeParseJSON(readFileSync(path, 'utf-8'), false)
  return parsed && typeof parsed === 'object' ? structuredClone(parsed) as T : null
}

export function repoSearch(repo: RepoIndex, query: string): RepoFileEntry[] {
  const q = query.toLowerCase()
  return repo.files.filter(f =>
    f.path.toLowerCase().includes(q) ||
    f.symbols?.some(s => s.toLowerCase().includes(q)) ||
    f.kind.includes(q),
  )
}

export function symbolSearch(symbols: SymbolIndex, query: string): SymbolEntry[] {
  const q = query.toLowerCase()
  return symbols.symbols.filter(s => s.name.toLowerCase().includes(q))
}

export function findCallers(calls: CallGraphIndex, symbol: string): CallEntry[] {
  return calls.calls.filter(c => c.callee === symbol)
}

export function findTestsForFile(tests: TestIndex, file: string): TestEntry[] {
  return tests.tests.filter(t => {
    if (t.file === file) return true
    const base = file.replace(/\.(?:[jt]sx?|[mc][jt]sx?)$/, '')
    return t.file.includes(base) || file.includes(t.file.replace(/\.[jt]sx?$/, ''))
  })
}

export function docSearch(docs: DocIndex, query: string): DocEntry[] {
  const q = query.toLowerCase()
  return docs.docs.filter(d =>
    d.path.toLowerCase().includes(q) || d.title?.toLowerCase().includes(q),
  )
}

export function formatRepoStats(repo: RepoIndex): string {
  const counts = repo.files.reduce(
    (acc, f) => {
      acc[f.kind] = (acc[f.kind] ?? 0) + 1
      return acc
    },
    {} as Record<RepoFileEntry['kind'], number>,
  )
  const lines = [
    `Repo index: ${repo.files.length} current files; ${repo.staleFiles?.length ?? 0} stale sources excluded`,
    `Coverage: ${repo.coverage ? `${repo.coverage.indexed}/${repo.coverage.candidates} candidates; ${repo.coverage.omittedByLimit} omitted by limit; ${repo.coverage.skipped.length} skipped` : 'unknown (rebuild to measure)'}`,
    ...Object.entries(counts).map(([k, v]) => `  ${k}: ${v}`),
  ]
  return lines.join('\n')
}
