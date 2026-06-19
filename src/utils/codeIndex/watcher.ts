import chokidar, { type FSWatcher } from 'chokidar'
import { extname, relative, sep } from 'node:path'
import { registerCleanup } from '../cleanupRegistry.js'
import { logForDebugging } from '../debug.js'
import { buildCodeGraph } from './graph.js'
import { buildOrUpdateIndex } from './indexer.js'

const WATCH_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
  '.py', '.pyi', '.rb', '.go', '.rs', '.java', '.kt', '.kts', '.scala',
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hpp', '.hxx', '.cs', '.swift',
  '.php', '.lua', '.dart', '.ex', '.exs', '.erl', '.clj', '.hs', '.ml',
  '.sh', '.bash', '.zsh', '.sql', '.graphql', '.gql', '.proto',
  '.vue', '.svelte', '.astro', '.css', '.scss', '.sass', '.less',
  '.md', '.mdx', '.rst', '.adoc', '.txt',
  '.json', '.yaml', '.yml', '.toml',
])

const SKIP_SEGMENTS = new Set(['node_modules', '.git', 'dist', 'build', '.ur'])

export type CodeIndexWatchOptions = {
  root: string
  graph?: boolean
  debounceMs?: number
  onStatus?: (message: string) => void
  onError?: (message: string) => void
}

export type CodeIndexWatcherHandle = {
  close: () => Promise<void>
}

let activeWatcher: FSWatcher | null = null
let activeRoot: string | null = null
let activeTimer: ReturnType<typeof setTimeout> | null = null
let running = false
let rerun = false

function toPosix(path: string): string {
  return sep === '\\' ? path.replaceAll('\\', '/') : path
}

export function isCodeIndexWatchable(root: string, path: string): boolean {
  const rel = toPosix(relative(root, path))
  if (!rel || rel.startsWith('..')) return false
  const segments = rel.split('/')
  if (segments.some(segment => SKIP_SEGMENTS.has(segment))) return false
  if (rel.endsWith('.min.js') || rel.endsWith('.min.css')) return false
  if (rel.endsWith('.lock') || rel.endsWith('lock.json')) return false
  return WATCH_EXTENSIONS.has(extname(rel).toLowerCase())
}

function shouldIgnoreWatchPath(root: string, path: string): boolean {
  const rel = toPosix(relative(root, path))
  if (!rel || rel.startsWith('..')) return false
  const segments = rel.split('/')
  if (segments.some(segment => SKIP_SEGMENTS.has(segment))) return true
  const ext = extname(rel).toLowerCase()
  if (!ext) return false
  return !isCodeIndexWatchable(root, path)
}

async function rebuild(options: CodeIndexWatchOptions): Promise<void> {
  if (running) {
    rerun = true
    return
  }
  running = true
  try {
    const signal = new AbortController().signal
    const { stats } = await buildOrUpdateIndex({ root: options.root, signal })
    if (options.graph) await buildCodeGraph({ root: options.root, signal })
    options.onStatus?.(
      `code-index refreshed: ${stats.filesIndexed} files, ${stats.chunksEmbedded} embedded`,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    options.onError?.(message)
    logForDebugging(`code-index watcher failed: ${message}`, { level: 'error' })
  } finally {
    running = false
    if (rerun) {
      rerun = false
      void rebuild(options)
    }
  }
}

function schedule(options: CodeIndexWatchOptions): void {
  if (activeTimer) clearTimeout(activeTimer)
  activeTimer = setTimeout(() => {
    activeTimer = null
    void rebuild(options)
  }, options.debounceMs ?? 2000)
  activeTimer.unref?.()
}

export function startCodeIndexWatcher(
  options: CodeIndexWatchOptions,
): CodeIndexWatcherHandle {
  if (activeWatcher && activeRoot === options.root) {
    return { close: closeCodeIndexWatcher }
  }
  void closeCodeIndexWatcher()
  activeRoot = options.root
  activeWatcher = chokidar.watch(options.root, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 200 },
    ignored: path => shouldIgnoreWatchPath(options.root, path),
    ignorePermissionErrors: true,
  })
  activeWatcher.on('add', path => {
    options.onStatus?.(`code-index change: ${path}`)
    schedule(options)
  })
  activeWatcher.on('change', path => {
    options.onStatus?.(`code-index change: ${path}`)
    schedule(options)
  })
  activeWatcher.on('unlink', path => {
    options.onStatus?.(`code-index removed: ${path}`)
    schedule(options)
  })
  activeWatcher.on('error', error => {
    const message = error instanceof Error ? error.message : String(error)
    options.onError?.(message)
  })
  registerCleanup(closeCodeIndexWatcher)
  void rebuild(options)
  return { close: closeCodeIndexWatcher }
}

export async function closeCodeIndexWatcher(): Promise<void> {
  if (activeTimer) {
    clearTimeout(activeTimer)
    activeTimer = null
  }
  const watcher = activeWatcher
  activeWatcher = null
  activeRoot = null
  if (watcher) await watcher.close()
}
