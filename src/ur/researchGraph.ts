// Research Graph v1 — the paper's research-memory entities, persisted as JSONL
// collections under .ur/graph/. (JSONL keeps it dependency-free and verifiable;
// it can migrate to SQLite later without changing the command surface.)
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
} from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'

export const ENTITIES = [
  'sources',
  'papers',
  'claims',
  'methods',
  'datasets',
  'metrics',
  'limitations',
  'citations',
  'concepts',
  'notes',
  'experiments',
  'open_questions',
  'links',
] as const

export type Entity = (typeof ENTITIES)[number]

export interface GraphRecord {
  ts: string
  text: string
}

const MAX_GRAPH_TEXT_BYTES = 64 * 1024

function escapesWorkspace(workspace: string, target: string): boolean {
  const rel = relative(workspace, target)
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
}

export function isEntity(s: string): s is Entity {
  return (ENTITIES as readonly string[]).includes(s)
}

function graphDirectory(cwd: string, create: boolean): string | undefined {
  const workspace = realpathSync(cwd)
  let current = workspace
  for (const segment of ['.ur', 'graph']) {
    current = join(current, segment)
    if (!existsSync(current)) {
      if (!create) return undefined
      mkdirSync(current, { mode: 0o700 })
    }
    const stat = lstatSync(current)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('graph storage must use regular workspace directories')
    }
    const resolved = realpathSync(current)
    if (escapesWorkspace(workspace, resolved)) {
      throw new Error('graph storage resolves outside the workspace')
    }
    current = resolved
  }
  return current
}

function collectionFile(
  cwd: string,
  entity: Entity,
  create: boolean,
): string | undefined {
  const directory = graphDirectory(cwd, create)
  if (!directory) return undefined
  const target = join(directory, `${entity}.jsonl`)
  if (!existsSync(target)) return create ? target : undefined
  const stat = lstatSync(target)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('graph collection must be a regular file')
  }
  return target
}

export function addEntity(cwd: string, entity: Entity, text: string): void {
  const normalized = text.trim()
  if (!normalized) throw new Error('graph record text cannot be empty')
  if (Buffer.byteLength(normalized, 'utf8') > MAX_GRAPH_TEXT_BYTES) {
    throw new Error(
      `graph record text exceeds ${MAX_GRAPH_TEXT_BYTES} bytes`,
    )
  }
  const f = collectionFile(cwd, entity, true)!
  appendFileSync(
    f,
    `${JSON.stringify({
      ts: new Date().toISOString(),
      text: normalized,
    } satisfies GraphRecord)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
}

export function listEntity(cwd: string, entity: Entity): GraphRecord[] {
  const f = collectionFile(cwd, entity, false)
  if (!f) return []
  const out: GraphRecord[] = []
  for (const line of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    try {
      const parsed = JSON.parse(line) as Partial<GraphRecord>
      if (
        typeof parsed.ts === 'string' &&
        typeof parsed.text === 'string'
      ) {
        out.push({ ts: parsed.ts, text: parsed.text })
      }
    } catch {
      // A damaged line is isolated; later valid JSONL records remain usable.
    }
  }
  return out
}

/** Counts per entity, for the graph summary. */
export function graphSummary(cwd: string): Record<Entity, number> {
  const out = {} as Record<Entity, number>
  for (const e of ENTITIES) out[e] = listEntity(cwd, e).length
  return out
}
