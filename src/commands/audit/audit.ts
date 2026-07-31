import { readFileSync, writeFileSync } from 'node:fs'
import type { LocalCommandResult } from '../../commands.js'
import {
  type AuditRecord,
  collectAuditRecords,
  formatAudit,
  verifyAuditChain,
} from '../../services/agents/auditExport.js'
import { getCwd } from '../../utils/cwd.js'
import { safeParseJSON } from '../../utils/json.js'

export async function call(args: string): Promise<LocalCommandResult> {
  const tokens = args.trim().split(/\s+/).filter(Boolean)
  const action = tokens[0] ?? 'export'

  if (action === 'verify') {
    const file = tokens[1]
    if (!file) {
      return { type: 'text', value: 'Usage: ur audit verify <export.jsonl>' }
    }
    const records = readFileSync(file, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map(line => safeParseJSON(line, false))
      .filter((v): v is AuditRecord => !!v && typeof v === 'object')
    const ok = verifyAuditChain(records)
    return {
      type: 'text',
      value: ok
        ? `Audit chain VERIFIED — ${records.length} records, hash chain intact.`
        : `Audit chain BROKEN — ${records.length} records, at least one hash does not match. The export was modified or reordered.`,
    }
  }

  if (action !== 'export') {
    return {
      type: 'text',
      value:
        'Usage: ur audit export [--format jsonl|csv] [--out <file>] | ur audit verify <file>',
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
