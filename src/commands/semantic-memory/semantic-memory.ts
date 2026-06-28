import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'
import { safeParseJSON } from '../../utils/json.js'

type MemoryEntry = {
  id: string
  source: string
  text: string
  tokens: string[]
}

type MemoryIndex = {
  version: 1
  mode: 'lexical'
  builtAt: string
  entries: MemoryEntry[]
}

function indexPath(): string {
  return join(getCwd(), '.ur', 'semantic-memory', 'index', 'index.json')
}

function tokenize(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? [])]
}

function sourceFiles(): string[] {
  const cwd = getCwd()
  const files: string[] = []
  for (const file of ['UR.md', 'README.md']) {
    const path = join(cwd, file)
    if (existsSync(path)) files.push(path)
  }
  for (const dir of [join(cwd, '.ur', 'memory'), join(cwd, '.ur', 'docs')]) {
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir)) {
      const path = join(dir, file)
      if (statSync(path).isFile() && /\.(md|txt|jsonl)$/i.test(file)) {
        files.push(path)
      }
    }
  }
  return files
}

function chunkText(source: string, text: string): MemoryEntry[] {
  return text
    .split(/\n\s*\n/)
    .map(part => part.trim())
    .filter(Boolean)
    .slice(0, 500)
    .map((part, index) => ({
      id: `${basename(source)}:${index + 1}`,
      source,
      text: part.length > 1600 ? `${part.slice(0, 1600)}...` : part,
      tokens: tokenize(part),
    }))
}

function buildIndex(): MemoryIndex {
  const entries = sourceFiles().flatMap(file =>
    chunkText(file, readFileSync(file, 'utf-8')),
  )
  const index: MemoryIndex = {
    version: 1,
    mode: 'lexical',
    builtAt: new Date().toISOString(),
    entries,
  }
  mkdirSync(join(getCwd(), '.ur', 'semantic-memory', 'index'), { recursive: true })
  writeFileSync(indexPath(), `${JSON.stringify(index, null, 2)}\n`)
  return index
}

function loadIndex(): MemoryIndex | null {
  if (!existsSync(indexPath())) return null
  const parsed = safeParseJSON(readFileSync(indexPath(), 'utf-8'), false)
  return parsed && typeof parsed === 'object' ? (parsed as MemoryIndex) : null
}

function searchIndex(index: MemoryIndex, query: string): Array<MemoryEntry & { score: number }> {
  const queryTokens = tokenize(query)
  return index.entries
    .map(entry => {
      const entryTokens = new Set(entry.tokens)
      const score = queryTokens.filter(token => entryTokens.has(token)).length
      return { ...entry, score }
    })
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
}

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const command = tokens.find(token => !token.startsWith('--')) ?? 'status'

  if (command === 'build') {
    const index = buildIndex()
    return {
      type: 'text',
      value: json
        ? JSON.stringify(index, null, 2)
        : `Built semantic memory index with ${index.entries.length} entries at ${indexPath()}`,
    }
  }

  const index = loadIndex()
  if (command === 'status') {
    const status = index
      ? { builtAt: index.builtAt, mode: index.mode, entries: index.entries.length, path: indexPath() }
      : { entries: 0, path: indexPath(), missing: true }
    return { type: 'text', value: json ? JSON.stringify(status, null, 2) : JSON.stringify(status, null, 2) }
  }

  if (command === 'search') {
    const query = tokens.filter(token => !token.startsWith('--') && token !== 'search').join(' ')
    const activeIndex = index ?? buildIndex()
    const results = searchIndex(activeIndex, query)
    if (json) return { type: 'text', value: JSON.stringify({ results }, null, 2) }
    if (results.length === 0) return { type: 'text', value: 'No memory matches.' }
    return {
      type: 'text',
      value: results
        .map(result => `${result.source} (${result.score})\n${result.text}`)
        .join('\n\n'),
    }
  }

  return { type: 'text', value: 'Usage: ur semantic-memory build|search|status [query] [--json]' }
}
