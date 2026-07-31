// Research Graph v1 — the paper's research-memory entities, persisted as JSONL
// collections under .ur/graph/. (JSONL keeps it dependency-free and verifiable;
// it can migrate to SQLite later without changing the command surface.)
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

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

const file = (cwd: string, entity: Entity): string => join(cwd, '.ur', 'graph', `${entity}.jsonl`)

export function isEntity(s: string): s is Entity {
  return (ENTITIES as readonly string[]).includes(s)
}

export function addEntity(cwd: string, entity: Entity, text: string): void {
  try {
    const f = file(cwd, entity)
    mkdirSync(dirname(f), { recursive: true })
    appendFileSync(f, JSON.stringify({ ts: new Date().toISOString(), text } satisfies GraphRecord) + '\n')
  } catch {
    /* best-effort */
  }
}

export function listEntity(cwd: string, entity: Entity): GraphRecord[] {
  const f = file(cwd, entity)
  if (!existsSync(f)) return []
  const out: GraphRecord[] = []
  for (const line of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    try {
      out.push(JSON.parse(line) as GraphRecord)
    } catch {
      /* skip */
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
