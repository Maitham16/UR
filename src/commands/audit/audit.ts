import { readFileSync, writeFileSync } from 'node:fs'
import {
  type AuditRecord,
  collectAuditRecords,
  formatAudit,
  verifyAuditChain,
} from '../../services/agents/auditExport.js'
import type { LocalCommandResult } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'
import { safeParseJSON } from '../../utils/json.js'

function isAuditRecord(value: unknown): value is AuditRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<AuditRecord>
  return (
    typeof record.ts === 'string' &&
    typeof record.source === 'string' &&
    (record.source === 'actions' || record.source.startsWith('run:')) &&
    typeof record.kind === 'string' &&
    typeof record.summary === 'string' &&
    (typeof record.ok === 'boolean' || record.ok === null) &&
    !!record.data &&
    typeof record.data === 'object' &&
    !Array.isArray(record.data) &&
    typeof record.hash === 'string'
  )
}

export async function call(args: string): Promise<LocalCommandResult> {
  const tokens = parseArguments(args)
  const action = tokens[0] ?? 'export'

  if (action === 'verify') {
    const file = tokens[1]
    if (!file) {
      return {
        type: 'text',
        value: 'Usage: ur audit verify <export.jsonl>',
        exitCode: 2,
      }
    }
    let source: string
    try {
      source = readFileSync(file, 'utf-8')
    } catch (error) {
      return {
        type: 'text',
        value: `Audit verification failed: ${error instanceof Error ? error.message : String(error)}`,
        exitCode: 1,
      }
    }
    const lines = source.split('\n').filter(line => line.trim().length > 0)
    if (lines.length === 0) {
      return {
        type: 'text',
        value: 'Audit chain BROKEN — the export contains no audit records.',
        exitCode: 1,
      }
    }
    const records: AuditRecord[] = []
    for (let index = 0; index < lines.length; index++) {
      const parsed = safeParseJSON(lines[index]!, false)
      if (!isAuditRecord(parsed)) {
        return {
          type: 'text',
          value: `Audit chain BROKEN — invalid audit record at JSONL line ${index + 1}.`,
          exitCode: 1,
        }
      }
      records.push(parsed)
    }
    const ok = verifyAuditChain(records)
    return {
      type: 'text',
      value: ok
        ? `Audit chain VERIFIED — ${records.length} records, hash chain intact.`
        : `Audit chain BROKEN — ${records.length} records, at least one hash does not match. The export was modified or reordered.`,
      ...(ok ? {} : { exitCode: 1 }),
    }
  }

  if (action !== 'export') {
    return {
      type: 'text',
      value:
        'Usage: ur audit export [--format jsonl|csv] [--out <file>] | ur audit verify <file>',
      exitCode: 2,
    }
  }

  const formatIdx = tokens.indexOf('--format')
  const format =
    formatIdx !== -1 && tokens[formatIdx + 1] === 'csv' ? 'csv' : 'jsonl'
  const outIdx = tokens.indexOf('--out')
  const out = outIdx !== -1 ? tokens[outIdx + 1] : undefined

  const records = collectAuditRecords(getCwd())
  const body = formatAudit(records, format)

  if (out) {
    writeFileSync(out, `${body}\n`)
    return {
      type: 'text',
      value: `Exported ${records.length} audit records to ${out} (${format}, hash-chained). Verify later with: ur audit verify ${out}`,
    }
  }
  return { type: 'text', value: body || 'No audit records found.' }
}
