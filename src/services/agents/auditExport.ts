import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeParseJSON } from '../../utils/json.js'
import { listRunIds, readRunActions } from './runArtifacts.js'

/**
 * Exportable audit trail: aggregates the tool-action ledger
 * (.ur/actions.jsonl) and every run's trace actions (.ur/runs/<id>) into a
 * single chronological stream, with a SHA-256 hash chain so consumers can
 * verify the export has not been reordered or edited after the fact.
 * Read-only: never mutates the underlying ledgers.
 */

export type AuditRecord = {
  ts: string
  source: 'actions' | `run:${string}`
  kind: string
  summary: string
  ok: boolean | null
  data: Record<string, unknown>
  /** SHA-256 over (previous record hash + this record's canonical JSON). */
  hash: string
}

function chainHash(prev: string, payload: unknown): string {
  return createHash('sha256')
    .update(prev)
    .update(JSON.stringify(payload))
    .digest('hex')
}

function readActionsLedger(cwd: string): Array<Record<string, unknown>> {
  const path = join(cwd, '.ur', 'actions.jsonl')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(line => safeParseJSON(line, false))
    .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
}

export function collectAuditRecords(cwd: string): AuditRecord[] {
  const raw: Array<Omit<AuditRecord, 'hash'>> = []

  for (const entry of readActionsLedger(cwd)) {
    raw.push({
      ts: String(entry.ts ?? ''),
      source: 'actions',
      kind: String(entry.tool ?? 'action'),
      summary:
        typeof entry.args === 'object' && entry.args !== null
          ? JSON.stringify(entry.args).slice(0, 200)
          : String(entry.tool ?? ''),
      ok: typeof entry.ok === 'boolean' ? entry.ok : null,
      data: entry,
    })
  }

  for (const runId of listRunIds(cwd)) {
    for (const action of readRunActions(cwd, runId)) {
      const a = action as unknown as Record<string, unknown>
      raw.push({
        ts: String(a.at ?? a.ts ?? ''),
        source: `run:${runId}`,
        kind: String(a.kind ?? 'run-action'),
        summary: String(a.title ?? a.kind ?? '').slice(0, 200),
        ok:
          a.status === 'passed'
            ? true
            : a.status === 'failed'
              ? false
              : null,
        data: a,
      })
    }
  }

  raw.sort((x, y) => x.ts.localeCompare(y.ts))

  let prev = 'genesis'
  return raw.map(record => {
    const hash = chainHash(prev, record)
    prev = hash
    return { ...record, hash }
  })
}

/** Recompute the chain and confirm every hash matches. */
export function verifyAuditChain(records: AuditRecord[]): boolean {
  let prev = 'genesis'
  for (const { hash, ...rest } of records) {
    if (chainHash(prev, rest) !== hash) return false
    prev = hash
  }
  return true
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function formatAudit(
  records: AuditRecord[],
  format: 'jsonl' | 'csv',
): string {
  if (format === 'csv') {
    const header = 'ts,source,kind,ok,summary,hash'
    const rows = records.map(r =>
      [r.ts, r.source, r.kind, String(r.ok), csvEscape(r.summary), r.hash].join(
        ',',
      ),
    )
    return [header, ...rows].join('\n')
  }
  return records.map(r => JSON.stringify(r)).join('\n')
}
