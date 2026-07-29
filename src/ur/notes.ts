// Lightweight persistent stores under .ur/: user memory notes and a research
// store (papers, citations, notes). JSONL, append-only. Write failures are
// deliberately surfaced so commands never report persistence that did not
// happen.
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, dirname, join, relative, sep } from 'node:path'

interface NoteRecord {
  ts: string
  text: string
  kind: string
}

function readJsonl(file: string | undefined): NoteRecord[] {
  if (!file || !existsSync(file)) return []
  const out: NoteRecord[] = []
  for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    try {
      const parsed = JSON.parse(line) as Partial<NoteRecord>
      if (
        typeof parsed.ts === 'string' &&
        typeof parsed.text === 'string' &&
        typeof parsed.kind === 'string'
      ) {
        out.push({
          ts: parsed.ts,
          text: parsed.text,
          kind: parsed.kind,
        })
      }
    } catch {
      // Isolate a damaged JSONL line while retaining later valid records.
    }
  }
  return out
}

function append(file: string, rec: NoteRecord): void {
  appendFileSync(file, JSON.stringify(rec) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  })
}

function writeAtomic(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(temporary, content, {mode: 0o600})
    renameSync(temporary, file)
  } catch (error) {
    try {
      if (existsSync(temporary)) unlinkSync(temporary)
    } catch {
      // Preserve the original write error.
    }
    throw error
  }
}

function escapesWorkspace(workspace: string, target: string): boolean {
  const rel = relative(workspace, target)
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
}

function projectStoreFile(
  cwd: string,
  directory: 'memory' | 'research',
  name: string,
  create: boolean,
): string | undefined {
  const workspace = realpathSync(cwd)
  let current = workspace
  for (const segment of ['.ur', directory]) {
    current = join(current, segment)
    if (!existsSync(current)) {
      if (!create) return undefined
      mkdirSync(current, { mode: 0o700 })
    }
    const stat = lstatSync(current)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`${directory} storage must use regular workspace directories`)
    }
    const resolved = realpathSync(current)
    if (escapesWorkspace(workspace, resolved)) {
      throw new Error(`${directory} storage resolves outside the workspace`)
    }
    current = resolved
  }
  const target = join(current, name)
  if (existsSync(target)) {
    const stat = lstatSync(target)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`${directory} collection must be a regular file`)
    }
  }
  return create || existsSync(target) ? target : undefined
}

const memFile = (cwd: string, create: boolean) =>
  projectStoreFile(cwd, 'memory', 'notes.jsonl', create)
const researchFile = (cwd: string, kind: string, create: boolean) =>
  projectStoreFile(cwd, 'research', `${kind}.jsonl`, create)
const MAX_NOTE_BYTES = 64 * 1024

function boundedText(text: string): string {
  const normalized = text.trim()
  if (!normalized) throw new Error('note text cannot be empty')
  if (Buffer.byteLength(normalized, 'utf8') > MAX_NOTE_BYTES) {
    throw new Error(`note text exceeds ${MAX_NOTE_BYTES} bytes`)
  }
  return normalized
}

function memorySlug(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .filter(Boolean)
    .slice(0, 8)
    .join('-')
  const hash = createHash('sha1').update(text).digest('hex').slice(0, 8)
  return `${words || 'remembered-note'}-${hash}`
}

function yamlSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function oneLine(text: string, max = 140): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`
}

export function rememberInAutoMemory(memoryDir: string, text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  try {
    mkdirSync(memoryDir, { recursive: true })
    const slug = memorySlug(trimmed)
    const fileName = `${slug}.md`
    const filePath = join(memoryDir, fileName)
    const description = oneLine(trimmed)
    const now = new Date().toISOString()
    writeFileSync(
      filePath,
      [
        '---',
        `name: ${yamlSingleQuote(description)}`,
        `description: ${yamlSingleQuote(description)}`,
        'type: feedback',
        '---',
        '',
        '# Remembered note',
        '',
        trimmed,
        '',
        `Saved: ${now}`,
        '',
      ].join('\n'),
    )

    const indexPath = join(memoryDir, 'MEMORY.md')
    const indexLine = `- [Remembered note](${fileName}) — ${description}`
    const existing = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : ''
    if (!existing.includes(`](${fileName})`)) {
      const prefix = existing.trimEnd()
      writeFileSync(indexPath, `${prefix ? `${prefix}\n` : ''}${indexLine}\n`)
    }
    return filePath
  } catch {
    return null
  }
}

// ── User memory ────────────────────────────────────────────────────────────
export function remember(cwd: string, text: string): void {
  append(memFile(cwd, true)!, {
    ts: new Date().toISOString(),
    text: boundedText(text),
    kind: 'note',
  })
}

export function listMemory(cwd: string): NoteRecord[] {
  return readJsonl(memFile(cwd, false))
}

/** Remove notes containing `needle` (case-insensitive). Returns count removed. */
export function forget(cwd: string, needle: string): number {
  const file = memFile(cwd, false)
  if (!file) return 0
  const all = readJsonl(file)
  const kept = all.filter((n) => !n.text.toLowerCase().includes(needle.toLowerCase()))
  const removed = all.length - kept.length
  if (removed > 0) {
    writeAtomic(
      file,
      kept.map((n) => JSON.stringify(n)).join('\n') +
        (kept.length ? '\n' : ''),
    )
  }
  return removed
}

/**
 * Remove promoted auto-memory topic files matching exact remembered texts and
 * repair MEMORY.md links. The deterministic content hash used by memorySlug is
 * the stable identifier shared with rememberInAutoMemory.
 */
export function forgetInAutoMemory(
  memoryDir: string,
  texts: readonly string[],
): number {
  if (!existsSync(memoryDir) || texts.length === 0) return 0
  const fileNames = new Set(texts.map(text => `${memorySlug(text.trim())}.md`))
  let removed = 0
  for (const fileName of fileNames) {
    const path = join(memoryDir, fileName)
    if (!existsSync(path)) continue
    unlinkSync(path)
    removed++
  }

  const indexPath = join(memoryDir, 'MEMORY.md')
  if (existsSync(indexPath)) {
    const existing = readFileSync(indexPath, 'utf8')
    const kept = existing
      .split('\n')
      .filter(line => ![...fileNames].some(fileName => line.includes(`](${fileName})`)))
      .join('\n')
    if (kept !== existing) {
      writeAtomic(indexPath, kept.endsWith('\n') ? kept : `${kept}\n`)
    }
  }
  return removed
}

// ── Research store ─────────────────────────────────────────────────────────
export function addResearch(cwd: string, kind: 'papers' | 'citations' | 'notes', text: string): void {
  append(researchFile(cwd, kind, true)!, {
    ts: new Date().toISOString(),
    text: boundedText(text),
    kind,
  })
}

export function listResearch(cwd: string, kind: 'papers' | 'citations' | 'notes'): NoteRecord[] {
  return readJsonl(researchFile(cwd, kind, false))
}
