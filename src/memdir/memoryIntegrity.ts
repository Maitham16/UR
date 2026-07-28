import { createHash, createHmac } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Tamper-evidence and provable deletion for the file-backed memory stores.
 *
 * Project task memory already had this: a hash-chained JSONL where each entry
 * links to the previous, so an edited or removed line is detectable. The
 * auto-memory, team-memory and knowledge stores had none of it — they are
 * directories of markdown, and a chain over append-only lines does not
 * describe a mutable file tree.
 *
 * The shape that does is a manifest of content digests. Verification compares
 * on-disk content against the recorded digest, which detects three distinct
 * problems the stores were previously blind to:
 *
 *   modified — content changed since it was recorded
 *   missing  — a recorded memory was deleted outside UR
 *   untracked— a file appeared that UR never wrote
 *
 * That last one matters most. Memory is injected into context, so a file
 * dropped into the memory directory by anything else is an injection vector
 * with a direct path to the model.
 *
 * Deletion is provable rather than silent: removing an entry rewrites the
 * manifest, so a previously-deleted memory reappearing is reported as
 * `untracked` instead of being quietly reloaded.
 */
export type MemoryIntegrityStatus =
  | 'ok'
  | 'modified'
  | 'missing'
  | 'untracked'

export type MemoryIntegrityEntry = {
  file: string
  status: MemoryIntegrityStatus
  recordedDigest: string | null
  actualDigest: string | null
  bytes: number | null
}

export type MemoryIntegrityReport = {
  dir: string
  manifestPath: string
  /** False when the directory does not exist — reported separately from
   * "exists but is empty", because a wrong path and an empty store are very
   * different problems and looked identical before. */
  exists: boolean
  signature: SignatureState
  valid: boolean
  entries: MemoryIntegrityEntry[]
  counts: Record<MemoryIntegrityStatus, number>
}

export type MemoryManifest = {
  version: 1
  updatedAt: string
  files: Record<string, { digest: string; bytes: number }>
  /**
   * HMAC over the file digests, keyed by a secret held outside the store.
   *
   * Without it the manifest defends only against accident and unaware
   * tampering: anyone who can write a memory file can also rewrite the
   * manifest to match, and verification passes. The signature raises that bar
   * to needing the key as well.
   *
   * Optional and absent by default. A key has to live somewhere, and a key
   * sitting next to the data it protects is theatre — so this is only worth
   * enabling when UR_MEMORY_INTEGRITY_KEY comes from somewhere the memory
   * directory is not, such as a password manager or CI secret.
   */
  signature?: string
}

const MANIFEST_NAME = '.integrity.json'

/** Key for signing. Absent means signing is off, which is the default. */
function signingKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env.UR_MEMORY_INTEGRITY_KEY?.trim()
  return key ? key : null
}

/**
 * Sign the file digests, not the whole manifest: `updatedAt` changes on every
 * re-record and would make the signature useless for comparison, and signing
 * the signature field is impossible.
 */
export function signManifest(
  files: MemoryManifest['files'],
  key: string,
): string {
  const canonical = Object.keys(files)
    .sort()
    .map(name => `${name}:${files[name]!.digest}`)
    .join('\n')
  return createHmac('sha256', key).update(canonical).digest('hex')
}

export type SignatureState = 'unsigned' | 'valid' | 'invalid' | 'unverifiable'

/**
 * `unverifiable` is its own state: a signed manifest with no key available
 * cannot be checked, and reporting that as valid would be the same
 * absence-as-evidence mistake the empty-store case had.
 */
export function checkSignature(
  manifest: MemoryManifest,
  env: NodeJS.ProcessEnv = process.env,
): SignatureState {
  const key = signingKey(env)
  if (!manifest.signature) return 'unsigned'
  if (!key) return 'unverifiable'
  return signManifest(manifest.files, key) === manifest.signature
    ? 'valid'
    : 'invalid'
}
/** Only memory content is tracked; the manifest cannot cover itself. */
const IGNORED = new Set([MANIFEST_NAME])

export function manifestPathFor(dir: string): string {
  return join(dir, MANIFEST_NAME)
}

export function digestOf(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

/** Every tracked file under `dir`, recursively, as paths relative to it. */
export function listMemoryFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const found: string[] = []
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (IGNORED.has(entry.name)) continue
      // A quarantine directory holds files already reported; re-tracking them
      // would make every quarantine permanently dirty.
      if (entry.isDirectory() && entry.name === 'quarantine') continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) found.push(relative(dir, full))
    }
  }
  walk(dir)
  return found.sort()
}

export function readManifest(dir: string): MemoryManifest | null {
  const path = manifestPathFor(dir)
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as MemoryManifest
    if (parsed?.version !== 1 || typeof parsed.files !== 'object') return null
    return parsed
  } catch {
    // A corrupt manifest must not throw during a normal memory read. It is
    // reported as "no manifest", which surfaces every file as untracked —
    // loud, and correct, since nothing can be vouched for.
    return null
  }
}

/** Record the current contents as the trusted baseline. */
export function recordManifest(dir: string): MemoryManifest {
  mkdirSync(dir, { recursive: true })
  const files: MemoryManifest['files'] = {}
  for (const file of listMemoryFiles(dir)) {
    const full = join(dir, file)
    files[file] = {
      digest: digestOf(readFileSync(full)),
      bytes: statSync(full).size,
    }
  }
  const key = signingKey()
  const manifest: MemoryManifest = {
    version: 1,
    updatedAt: new Date().toISOString(),
    files,
    ...(key ? { signature: signManifest(files, key) } : {}),
  }
  writeFileSync(manifestPathFor(dir), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

export function verifyMemoryStore(dir: string): MemoryIntegrityReport {
  const manifest = readManifest(dir)
  const onDisk = listMemoryFiles(dir)
  const entries: MemoryIntegrityEntry[] = []
  const recorded = manifest?.files ?? {}

  for (const file of onDisk) {
    const full = join(dir, file)
    const actual = digestOf(readFileSync(full))
    const expected = recorded[file]?.digest ?? null
    entries.push({
      file,
      status: !expected ? 'untracked' : expected === actual ? 'ok' : 'modified',
      recordedDigest: expected,
      actualDigest: actual,
      bytes: statSync(full).size,
    })
  }

  // A recorded file that is gone was deleted outside UR — the case a digest
  // check over present files alone would miss entirely.
  for (const file of Object.keys(recorded)) {
    if (onDisk.includes(file)) continue
    entries.push({
      file,
      status: 'missing',
      recordedDigest: recorded[file]!.digest,
      actualDigest: null,
      bytes: null,
    })
  }

  entries.sort((a, b) => a.file.localeCompare(b.file))
  const counts: Record<MemoryIntegrityStatus, number> = {
    ok: 0,
    modified: 0,
    missing: 0,
    untracked: 0,
  }
  for (const entry of entries) counts[entry.status]++

  return {
    dir,
    manifestPath: manifestPathFor(dir),
    exists: existsSync(dir),
    signature: manifest ? checkSignature(manifest) : 'unsigned',
    // No manifest means nothing can be vouched for, even if the directory is
    // empty — "valid" would be a claim we cannot support. An empty store is
    // also not "valid": zero files checked is not evidence of integrity, and
    // saying so would give the same reassurance for a correct empty store, a
    // mistyped path, and a store an attacker just emptied.
    // A tampered or uncheckable signature is not valid, whatever the digests
    // say — that is the whole point of signing.
    valid:
      manifest !== null &&
      checkSignature(manifest) !== 'invalid' &&
      checkSignature(manifest) !== 'unverifiable' &&
      entries.length > 0 &&
      counts.modified === 0 &&
      counts.untracked === 0 &&
      counts.missing === 0,
    entries,
    counts,
  }
}

export type QuarantineResult = {
  quarantined: string[]
  quarantineDir: string | null
}

/**
 * Move every file that failed verification out of the store, so the next read
 * cannot inject it. Files are moved rather than deleted: a false positive must
 * be recoverable, and the quarantined copy is the evidence of what happened.
 */
export function quarantineMemoryStore(
  dir: string,
  now: Date = new Date(),
): QuarantineResult {
  const report = verifyMemoryStore(dir)
  const suspect = report.entries.filter(
    entry => entry.status === 'modified' || entry.status === 'untracked',
  )
  if (suspect.length === 0) return { quarantined: [], quarantineDir: null }

  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const quarantineDir = join(dir, 'quarantine', stamp)
  mkdirSync(quarantineDir, { recursive: true })
  const quarantined: string[] = []
  for (const entry of suspect) {
    const from = join(dir, entry.file)
    if (!existsSync(from)) continue
    const to = join(quarantineDir, entry.file.replace(/[/\\]/g, '__'))
    renameSync(from, to)
    quarantined.push(entry.file)
  }
  // Re-baseline so the store is clean afterwards; the quarantine directory
  // keeps the removed content for inspection.
  recordManifest(dir)
  return { quarantined, quarantineDir }
}

export function formatMemoryIntegrity(
  report: MemoryIntegrityReport,
  json: boolean,
): string {
  if (json) return JSON.stringify(report, null, 2)
  if (!report.exists) {
    return (
      `${report.dir}\n` +
      `  no such directory — nothing was checked. If you expected memory here,\n` +
      `  the path is wrong; verifying a path that does not exist proves nothing.`
    )
  }
  if (report.signature === 'invalid') {
    return (
      `${report.dir}\n` +
      `  SIGNATURE INVALID — the manifest does not match its signature.\n` +
      `  Someone with write access to this directory rewrote the manifest\n` +
      `  without the key. Treat every file here as untrusted.`
    )
  }
  if (report.signature === 'unverifiable') {
    return (
      `${report.dir}\n` +
      `  signed, but UR_MEMORY_INTEGRITY_KEY is not set, so the signature\n` +
      `  could not be checked. Nothing here can be vouched for without it.`
    )
  }
  if (report.entries.length === 0) {
    return (
      `${report.dir}\n` +
      `  empty — no memory files, so nothing was checked.\n` +
      `  This is not a pass: an empty store and a correctly verified one are\n` +
      `  different claims, and only the second is evidence of integrity.`
    )
  }
  const lines = [
    `${report.dir}`,
    report.valid
      ? `  verified — ${report.counts.ok} file(s) match the recorded digests`
      : `  NOT VERIFIED`,
    '',
  ]
  if (!readManifest(report.dir)) {
    lines.push(
      '  No integrity manifest recorded yet. Run `ur memory-integrity record`',
      '  to establish the baseline; until then nothing can be vouched for.',
      '',
    )
  }
  for (const entry of report.entries) {
    if (entry.status === 'ok') continue
    lines.push(`  [${entry.status}] ${entry.file}`)
  }
  if (!report.valid) {
    lines.push(
      '',
      `  modified: ${report.counts.modified}  missing: ${report.counts.missing}  untracked: ${report.counts.untracked}`,
      '  Memory is injected into context, so an untracked file is an injection',
      '  vector. Run `ur memory-integrity quarantine` to move suspect files aside.',
    )
  }
  return lines.join('\n')
}
