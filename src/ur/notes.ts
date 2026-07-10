// Lightweight persistent stores under .ur/: user memory notes and a research
// store (papers, citations, notes). JSONL, append-only, never throws.
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

interface NoteRecord {
  ts: string
  text: string
  kind: string
}

function readJsonl(file: string): NoteRecord[] {
  if (!existsSync(file)) return []
  const out: NoteRecord[] = []
  for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    try {
      out.push(JSON.parse(line) as NoteRecord)
    } catch {
      /* skip */
    }
  }
  return out
}

function append(file: string, rec: NoteRecord): void {
  try {
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, JSON.stringify(rec) + '\n')
  } catch {
    /* best-effort */
  }
}

const memFile = (cwd: string) => join(cwd, '.ur', 'memory', 'notes.jsonl')
const researchFile = (cwd: string, kind: string) => join(cwd, '.ur', 'research', `${kind}.jsonl`)

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
  append(memFile(cwd), { ts: new Date().toISOString(), text, kind: 'note' })
}

export function listMemory(cwd: string): NoteRecord[] {
  return readJsonl(memFile(cwd))
}

/** Remove notes containing `needle` (case-insensitive). Returns count removed. */
export function forget(cwd: string, needle: string): number {
  const file = memFile(cwd)
  const all = readJsonl(file)
  const kept = all.filter((n) => !n.text.toLowerCase().includes(needle.toLowerCase()))
  const removed = all.length - kept.length
  if (removed > 0) {
    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, kept.map((n) => JSON.stringify(n)).join('\n') + (kept.length ? '\n' : ''))
    } catch {
      /* best-effort */
    }
  }
  return removed
}

// ── Research store ─────────────────────────────────────────────────────────
export function addResearch(cwd: string, kind: 'papers' | 'citations' | 'notes', text: string): void {
  append(researchFile(cwd, kind), { ts: new Date().toISOString(), text, kind })
}

export function listResearch(cwd: string, kind: 'papers' | 'citations' | 'notes'): NoteRecord[] {
  return readJsonl(researchFile(cwd, kind))
}
