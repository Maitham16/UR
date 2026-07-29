// Real, dependency-free file operations for /read, /search, /index.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'build', '.cache', 'vendor', '__pycache__'])
const TEXT_EXT = new Set([
  '.txt', '.md', '.rst', '.tex', '.bib', '.json', '.jsonl', '.yaml', '.yml', '.toml', '.xml', '.html', '.htm',
  '.css', '.js', '.ts', '.tsx', '.jsx', '.py', '.java', '.c', '.h', '.cpp', '.hpp', '.cs', '.go', '.rs', '.php',
  '.rb', '.swift', '.kt', '.scala', '.r', '.sh', '.zsh', '.bash', '.ps1', '.sql', '.csv', '.tsv', '.ini', '.cfg', '.conf', '.log',
])
const isTextLike = (p: string): boolean => TEXT_EXT.has(extname(p).toLowerCase()) || /(^|\/)(Dockerfile|Makefile|CMakeLists\.txt)$/.test(p)

function containsParentTraversal(target: string): boolean {
  return target.split(/[\\/]/).some(segment => segment === '..')
}

function escapesWorkspace(workspace: string, target: string): boolean {
  const rel = relative(workspace, target)
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
}

/** Read a text-like file contained within cwd. Binary types are reported, not dumped. */
export function readFileSafe(cwd: string, target: string, maxBytes = 64_000): { ok: boolean; content?: string; error?: string } {
  if (isAbsolute(target)) {
    return { ok: false, error: 'absolute paths are not allowed; use a workspace-relative path' }
  }
  if (containsParentTraversal(target)) {
    return { ok: false, error: 'parent path traversal (..) is not allowed' }
  }

  const requestedPath = resolve(cwd, target)
  if (!existsSync(requestedPath)) return { ok: false, error: `not found: ${target}` }

  let workspace: string
  let abs: string
  try {
    workspace = realpathSync(cwd)
    abs = realpathSync(requestedPath)
  } catch (error) {
    return {
      ok: false,
      error: `cannot resolve ${target}: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  if (escapesWorkspace(workspace, abs)) {
    return { ok: false, error: `path resolves outside the workspace: ${target}` }
  }

  let st: ReturnType<typeof statSync>
  try {
    st = statSync(abs)
  } catch (error) {
    return {
      ok: false,
      error: `cannot inspect ${target}: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  if (st.isDirectory()) return { ok: false, error: `${target} is a directory (use /index or /search)` }
  if (!isTextLike(abs)) return { ok: false, error: `not a text file (${extname(abs) || 'no ext'}). For images use /image, for video /video, for PDFs/docs ask UR to read it.` }
  try {
    let content = readFileSync(abs, 'utf8')
    if (content.length > maxBytes) content = content.slice(0, maxBytes) + `\n… [truncated at ${maxBytes} bytes]`
    return { ok: true, content }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

function* walk(
  dir: string,
  root: string,
  workspace: string,
  budget = { n: 0 },
  max = 8000,
): Generator<string> {
  if (budget.n >= max) return
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (budget.n >= max) return
    if (e.name.startsWith('.') && e.name !== '.ur') continue
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      yield* walk(full, root, workspace, budget, max)
    } else {
      try {
        const resolved = realpathSync(full)
        if (escapesWorkspace(workspace, resolved)) continue
        if (!statSync(resolved).isFile()) continue
      } catch {
        continue
      }
      budget.n++
      yield relative(root, full)
    }
  }
}

function resolveWorkspace(cwd: string): string | undefined {
  try {
    return realpathSync(cwd)
  } catch {
    return undefined
  }
}

function ensureWorkspaceDirectory(
  workspace: string,
  segments: readonly string[],
): string {
  let current = workspace
  for (const segment of segments) {
    current = join(current, segment)
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 })
    const resolved = realpathSync(current)
    if (escapesWorkspace(workspace, resolved)) {
      throw new Error('index storage resolves outside the workspace')
    }
    if (!statSync(resolved).isDirectory() || resolved !== current) {
      throw new Error('index storage must use regular workspace directories')
    }
    current = resolved
  }
  return current
}

export interface SearchHit {
  file: string
  line: number
  text: string
}

/** Search text-like files under cwd for `query` (case-insensitive substring). */
export function searchFiles(cwd: string, query: string, maxResults = 60): SearchHit[] {
  const q = query.toLowerCase()
  const hits: SearchHit[] = []
  const workspace = resolveWorkspace(cwd)
  if (!workspace) return hits
  for (const rel of walk(workspace, workspace, workspace)) {
    if (!isTextLike(rel)) continue
    let lines: string[]
    try {
      lines = readFileSync(join(workspace, rel), 'utf8').split('\n')
    } catch {
      continue
    }
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.toLowerCase().includes(q)) {
        hits.push({ file: rel, line: i + 1, text: lines[i]!.trim().slice(0, 160) })
        if (hits.length >= maxResults) return hits
      }
    }
  }
  return hits
}

export type WorkspaceIndexResult = {
  count: number
  sample: string[]
  path: string
  written: boolean
  error?: string
}

/** Build and atomically persist a path-only workspace index. */
export function indexWorkspace(cwd: string): WorkspaceIndexResult {
  const workspace = resolveWorkspace(cwd)
  const files = workspace ? [...walk(workspace, workspace, workspace)] : []
  const indexDir = join(workspace ?? cwd, '.ur', 'index')
  const path = join(indexDir, 'files.txt')
  let temporary: string | undefined
  try {
    if (!workspace) throw new Error('workspace cannot be resolved')
    const safeIndexDir = ensureWorkspaceDirectory(
      workspace,
      ['.ur', 'index'],
    )
    temporary = join(
      safeIndexDir,
      `.files.${process.pid}.${randomUUID()}.tmp`,
    )
    writeFileSync(temporary, `${files.join('\n')}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    renameSync(temporary, join(safeIndexDir, 'files.txt'))
    return {
      count: files.length,
      sample: files.slice(0, 20),
      path,
      written: true,
    }
  } catch (error) {
    if (temporary) {
      try {
        unlinkSync(temporary)
      } catch {
        // Preserve the original persistence error.
      }
    }
    return {
      count: files.length,
      sample: files.slice(0, 20),
      path,
      written: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
