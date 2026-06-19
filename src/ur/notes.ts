// Lightweight persistent stores under .ur/: user memory notes and a research
// store (papers, citations, notes). JSONL, append-only, never throws.
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
