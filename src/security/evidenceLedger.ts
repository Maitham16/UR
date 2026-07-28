import { createHash } from 'node:crypto'

/**
 * A record of every untrusted block that entered context this session.
 *
 * `wrapUntrusted` already stamps each block with a nonce and a source label,
 * so the provenance data exists — it was just discarded the moment the block
 * was handed to the model. Without a ledger there is no way to answer "where
 * did that claim come from" after the fact, which is the whole point of the
 * boundary: the model is told to treat the content as data, but the user is
 * given no way to audit what data it saw.
 *
 * Deliberately in-memory and per-process. Persisting it would create a second
 * on-disk store of fetched third-party content — including anything a
 * prompt-injection attempt put there — with its own retention and deletion
 * obligations. The ledger answers questions about the current session; the
 * transcript remains the durable record.
 */
export type EvidenceEntry = {
  nonce: string
  source: string
  /** Milliseconds since epoch, so entries can be ordered and aged out. */
  recordedAt: number
  bytes: number
  /** Whether scanForInjection flagged the block when it was wrapped. */
  suspicious: boolean
  signals: string[]
  /** sha256 of the cleaned content — lets a claim be matched without
   * retaining the full third-party text for every block. */
  digest: string
  /** Retained only up to PREVIEW_LIMIT so /evidence can show context. */
  preview: string
}

const PREVIEW_LIMIT = 240

/**
 * Bounded so a long session with heavy web use cannot grow without limit.
 * Oldest entries are dropped first; the cap is well above a realistic
 * session's untrusted-block count.
 */
const MAX_ENTRIES = 500

let ledger: EvidenceEntry[] = []
/** Full text is kept separately and only while the entry is live, so
 * `/evidence --check` can search it without EvidenceEntry carrying it. */
let bodies = new Map<string, string>()

export function recordEvidence(entry: {
  nonce: string
  source: string
  content: string
  suspicious: boolean
  signals: string[]
  now?: number
}): EvidenceEntry {
  const record: EvidenceEntry = {
    nonce: entry.nonce,
    source: entry.source,
    recordedAt: entry.now ?? Date.now(),
    bytes: Buffer.byteLength(entry.content, 'utf8'),
    suspicious: entry.suspicious,
    signals: entry.signals,
    digest: createHash('sha256').update(entry.content).digest('hex'),
    preview: entry.content.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_LIMIT),
  }
  ledger.push(record)
  bodies.set(record.nonce, entry.content)
  while (ledger.length > MAX_ENTRIES) {
    const dropped = ledger.shift()
    if (dropped) bodies.delete(dropped.nonce)
  }
  return record
}

export function listEvidence(): readonly EvidenceEntry[] {
  return ledger
}

export function clearEvidenceForTesting(): void {
  ledger = []
  bodies = new Map()
}

/**
 * Which recorded blocks contain the given span.
 *
 * This is the honest half of claim-to-source attribution: it proves a span
 * *appears in* a source, which is what can be checked mechanically. It does
 * not prove the model used that source to produce the claim — nothing
 * observable from outside the model can. A span found in no source is the
 * genuinely useful signal, because it means the answer was not grounded in
 * anything UR fetched.
 */
export function findEvidenceFor(span: string): EvidenceEntry[] {
  const needle = normalize(span)
  if (needle.length < 12) return []
  return ledger.filter(entry =>
    normalize(bodies.get(entry.nonce) ?? '').includes(needle),
  )
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

export function formatEvidence(
  entries: readonly EvidenceEntry[],
  json: boolean,
): string {
  if (json) return JSON.stringify({ evidence: entries }, null, 2)
  if (entries.length === 0) {
    return 'No untrusted content has entered this session. Nothing fetched from the web or an MCP server yet.'
  }
  const lines = [`Untrusted sources this session (${entries.length})`, '']
  for (const entry of entries) {
    const flag = entry.suspicious ? `  ⚠ ${entry.signals.join(', ')}` : ''
    lines.push(
      `  ${new Date(entry.recordedAt).toISOString().slice(11, 19)}  ` +
        `${entry.source}  ${entry.bytes}B  ${entry.digest.slice(0, 12)}${flag}`,
    )
    lines.push(`      ${entry.preview}`)
  }
  const flagged = entries.filter(entry => entry.suspicious).length
  if (flagged > 0) {
    lines.push('', `${flagged} block(s) matched an injection signal.`)
  }
  return lines.join('\n')
}

export function formatEvidenceCheck(
  span: string,
  matches: EvidenceEntry[],
): string {
  if (span.trim().length < 12) {
    return 'Give a longer span to check — short fragments match too much to be meaningful.'
  }
  if (matches.length === 0) {
    return (
      `Not found in any fetched source.\n` +
      `That span was not grounded in anything UR retrieved this session, so it ` +
      `came from the model rather than from evidence.`
    )
  }
  const lines = [`Found in ${matches.length} source(s):`, '']
  for (const match of matches) {
    lines.push(`  ${match.source}  ${match.digest.slice(0, 12)}`)
  }
  return lines.join('\n')
}
