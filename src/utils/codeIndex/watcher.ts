import chokidar, { type FSWatcher } from 'chokidar'
import { registerCleanup } from '../cleanupRegistry.js'
import { logForDebugging } from '../debug.js'
import { buildCodeGraph } from './graph.js'
import { buildOrUpdateIndex } from './indexer.js'
import { buildRepoIndex } from './repoIndex.js'
import { isCodeIndexWatchable, shouldIgnoreWatchPath } from './watchPaths.js'
export { isCodeIndexWatchable } from './watchPaths.js'

export type CodeIndexWatchOptions = {
  root: string
  graph?: boolean
  repo?: boolean
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
    if (options.repo) {
      const repoStats = await buildRepoIndex({ root: options.root, signal })
      options.onStatus?.(
        `repo-index refreshed: ${repoStats.repo.files.length} files, ${repoStats.symbols.symbols.length} symbols`,
      )
    }
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
