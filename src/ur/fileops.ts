// Real, dependency-free file operations for /read, /search, /index.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'build', '.cache', 'vendor', '__pycache__'])
const TEXT_EXT = new Set([
  '.txt', '.md', '.rst', '.tex', '.bib', '.json', '.jsonl', '.yaml', '.yml', '.toml', '.xml', '.html', '.htm',
  '.css', '.js', '.ts', '.tsx', '.jsx', '.py', '.java', '.c', '.h', '.cpp', '.hpp', '.cs', '.go', '.rs', '.php',
  '.rb', '.swift', '.kt', '.scala', '.r', '.sh', '.zsh', '.bash', '.ps1', '.sql', '.csv', '.tsv', '.ini', '.cfg', '.conf', '.log',
])
const isTextLike = (p: string): boolean => TEXT_EXT.has(extname(p).toLowerCase()) || /(^|\/)(Dockerfile|Makefile|CMakeLists\.txt)$/.test(p)

/** Read a text-like file (relative to cwd or absolute). Binary types are reported, not dumped. */
export function readFileSafe(cwd: string, target: string, maxBytes = 64_000): { ok: boolean; content?: string; error?: string } {
  const abs = isAbsolute(target) ? target : resolve(cwd, target)
  if (!existsSync(abs)) return { ok: false, error: `not found: ${target}` }
  const st = statSync(abs)
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

function* walk(dir: string, root: string, budget = { n: 0 }, max = 8000): Generator<string> {
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
      yield* walk(full, root, budget, max)
    } else {
      budget.n++
      yield relative(root, full)
    }
  }
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
  for (const rel of walk(cwd, cwd)) {
    if (!isTextLike(rel)) continue
    let lines: string[]
    try {
      lines = readFileSync(join(cwd, rel), 'utf8').split('\n')
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

/** Build a workspace file index, save to .ur/index/files.txt, return count + sample. */
export function indexWorkspace(cwd: string): { count: number; sample: string[] } {
  const files = [...walk(cwd, cwd)]
  try {
    mkdirSync(join(cwd, '.ur', 'index'), { recursive: true })
    writeFileSync(join(cwd, '.ur', 'index', 'files.txt'), files.join('\n') + '\n')
  } catch {
    /* best-effort */
  }
  return { count: files.length, sample: files.slice(0, 20) }
}
