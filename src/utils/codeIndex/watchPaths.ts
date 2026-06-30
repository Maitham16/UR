import { extname, relative, sep } from 'node:path'

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

export function shouldIgnoreWatchPath(root: string, path: string): boolean {
  const rel = toPosix(relative(root, path))
  if (!rel || rel.startsWith('..')) return false
  const segments = rel.split('/')
  if (segments.some(segment => SKIP_SEGMENTS.has(segment))) return true
  const ext = extname(rel).toLowerCase()
  if (!ext) return false
  return !isCodeIndexWatchable(root, path)
}
