import { createHash, type Hash } from 'node:crypto'

/**
 * Stops a model repeating a tool call that keeps failing.
 *
 * A 4B model refused once by the task-list gate answered by emitting `Write`
 * with no arguments — no file_path, no content — over and over, plus
 * `Computer(type 0 chars)`. Nothing stopped it. The trajectory grader already
 * names this `repeated-identical-failure`, but only after the run is over, so
 * it can grade the wreck and never prevent it.
 *
 * The rule is narrow on purpose: identical tool *and* identical input. A model
 * retrying with corrected arguments is doing exactly what a refusal asked of
 * it, and must never be penalised for that.
 */
export type RepeatedFailureConfig = {
  /** When false the guard never refuses or aborts, whatever it has recorded. */
  enabled: boolean
  /** Identical failures tolerated before the call is refused outright. */
  limit: number
  /** Attempts after the limit before the turn is aborted entirely. */
  abortAfter: number
  /** Optional tool-specific recovery instruction appended to a refusal. */
  recoveryHint?: string
}

// Off by default; callers that want loop protection pass an enabled config.
export const REPEATED_FAILURE_DEFAULTS: RepeatedFailureConfig = {
  enabled: false,
  limit: 3,
  abortAfter: 6,
}

/**
 * Fixed resource limits keep the hot-path guard from becoming an accidental
 * store for tool payloads or old query chains. Exported for focused tests and
 * operational visibility; callers should not need to branch on these values.
 */
export const REPEATED_FAILURE_GUARD_LIMITS = {
  maxEntries: 2048,
  maxEntriesPerScope: 256,
  entryTtlMs: 30 * 60 * 1000,
  maxCanonicalNodes: 50_000,
  maxCanonicalDepth: 128,
  maxCanonicalTextCodeUnits: 1_000_000,
} as const

const SIGNATURE_VERSION = 'rf2'
const UNSCOPED_DIGEST = '-'
const SHA256_HEX_LENGTH = 64
const HASH_CHUNK_CODE_UNITS = 16 * 1024
const UNSCOPED_SIGNATURE_LENGTH =
  SIGNATURE_VERSION.length + 3 + 1 + SHA256_HEX_LENGTH * 2
const SCOPED_SIGNATURE_LENGTH =
  SIGNATURE_VERSION.length + 3 + SHA256_HEX_LENGTH * 3

type FailureRecord = {
  failures: number
  lastFailureAt: number
  scopeDigest: string
}

const failureCounts = new Map<string, FailureRecord>()
let serializationFailureNonce = 0n
let repeatedFailureNow: () => number = Date.now

export function resetRepeatedFailuresForTesting(): void {
  failureCounts.clear()
  serializationFailureNonce = 0n
  repeatedFailureNow = Date.now
}

/** Allows focused TTL tests without sleeping or changing the process clock. */
export function setRepeatedFailureClockForTesting(
  clock?: () => number,
): void {
  repeatedFailureNow = clock ?? Date.now
}

type DigestState = {
  hash: Hash
  nextReference: number
  nodesVisited: number
  textCodeUnitsVisited: number
  seen: WeakMap<object, number>
}

class CanonicalTraversalLimitError extends Error {}

/**
 * Hash strings in bounded chunks. The length framing makes adjacent values
 * unambiguous without retaining a serialized payload in memory.
 */
function writeFramedText(hash: Hash, value: string): void {
  hash.update(`${value.length}:`)
  for (let offset = 0; offset < value.length; ) {
    const end = Math.min(offset + HASH_CHUNK_CODE_UNITS, value.length)
    // UTF-16LE preserves every JavaScript code unit, including lone
    // surrogates that UTF-8 would normalize to the same replacement byte.
    hash.update(value.slice(offset, end), 'utf16le')
    offset = end
  }
}

function writeToken(hash: Hash, kind: string, value = ''): void {
  writeFramedText(hash, kind)
  writeFramedText(hash, value)
}

function visitCanonical(
  value: unknown,
  state: DigestState,
  depth: number,
): void {
  state.nodesVisited++
  if (
    state.nodesVisited > REPEATED_FAILURE_GUARD_LIMITS.maxCanonicalNodes ||
    depth > REPEATED_FAILURE_GUARD_LIMITS.maxCanonicalDepth
  ) {
    throw new CanonicalTraversalLimitError()
  }

  if (value === null) {
    writeToken(state.hash, 'null')
    return
  }

  switch (typeof value) {
    case 'string':
      state.textCodeUnitsVisited += value.length
      if (
        state.textCodeUnitsVisited >
        REPEATED_FAILURE_GUARD_LIMITS.maxCanonicalTextCodeUnits
      ) {
        throw new CanonicalTraversalLimitError()
      }
      writeToken(state.hash, 'string', value)
      return
    case 'number':
      writeToken(
        state.hash,
        'number',
        Object.is(value, -0) ? '-0' : String(value),
      )
      return
    case 'boolean':
      writeToken(state.hash, 'boolean', String(value))
      return
    case 'undefined':
      writeToken(state.hash, 'undefined')
      return
    case 'bigint':
      writeToken(state.hash, 'bigint', value.toString())
      return
    case 'symbol': {
      const description = String(value.description ?? '')
      state.textCodeUnitsVisited += description.length
      if (
        state.textCodeUnitsVisited >
        REPEATED_FAILURE_GUARD_LIMITS.maxCanonicalTextCodeUnits
      ) {
        throw new CanonicalTraversalLimitError()
      }
      writeToken(state.hash, 'symbol', description)
      return
    }
    case 'function': {
      const name = value.name || '<anonymous>'
      state.textCodeUnitsVisited += name.length
      if (
        state.textCodeUnitsVisited >
        REPEATED_FAILURE_GUARD_LIMITS.maxCanonicalTextCodeUnits
      ) {
        throw new CanonicalTraversalLimitError()
      }
      writeToken(state.hash, 'function', name)
      return
    }
    case 'object': {
      const object = value as object
      const existingReference = state.seen.get(object)
      if (existingReference !== undefined) {
        writeToken(state.hash, 'reference', String(existingReference))
        return
      }

      const reference = state.nextReference++
      state.seen.set(object, reference)

      if (Array.isArray(value)) {
        if (
          value.length + state.nodesVisited >
          REPEATED_FAILURE_GUARD_LIMITS.maxCanonicalNodes
        ) {
          throw new CanonicalTraversalLimitError()
        }
        writeToken(state.hash, 'array', String(value.length))
        for (let index = 0; index < value.length; index++) {
          if (!(index in value)) {
            writeToken(state.hash, 'hole')
            continue
          }
          visitCanonical(value[index], state, depth + 1)
        }
        return
      }

      const record = value as Record<string, unknown>
      const keys = Object.keys(record)
      if (
        keys.length + state.nodesVisited >
        REPEATED_FAILURE_GUARD_LIMITS.maxCanonicalNodes
      ) {
        throw new CanonicalTraversalLimitError()
      }
      keys.sort()
      writeToken(state.hash, 'object', String(keys.length))
      for (const key of keys) {
        state.textCodeUnitsVisited += key.length
        if (
          state.textCodeUnitsVisited >
          REPEATED_FAILURE_GUARD_LIMITS.maxCanonicalTextCodeUnits
        ) {
          throw new CanonicalTraversalLimitError()
        }
        writeToken(state.hash, 'key', key)
        visitCanonical(record[key], state, depth + 1)
      }
      return
    }
  }
}

function digestText(domain: string, value: string): string {
  const hash = createHash('sha256')
  writeToken(hash, 'domain', domain)
  writeToken(hash, 'value', value)
  return hash.digest('hex')
}

function canonicalInputDigest(input: unknown): string {
  const hash = createHash('sha256')
  writeToken(hash, 'domain', 'repeated-failure-input-v2')
  visitCanonical(
    input,
    {
      hash,
      nextReference: 0,
      nodesVisited: 0,
      textCodeUnitsVisited: 0,
      seen: new WeakMap<object, number>(),
    },
    0,
  )
  return hash.digest('hex')
}

function uniqueSerializationFailureDigest(): string {
  serializationFailureNonce++
  return digestText(
    'repeated-failure-unserializable-v2',
    serializationFailureNonce.toString(),
  )
}

function scopeDigest(scope?: string): string {
  return scope
    ? digestText('repeated-failure-scope-v2', scope)
    : UNSCOPED_DIGEST
}

/**
 * Stable across key order, so `{a:1,b:2}` and `{b:2,a:1}` count as the same
 * call. The returned signature has a fixed upper bound and contains no raw
 * tool name, scope, or input.
 *
 * Unsupported, hostile, or over-budget values receive a unique digest. That
 * deliberately disables repeat detection for that value instead of allowing
 * two serialization failures to poison each other's history.
 */
export function callSignature(
  toolName: string,
  input: unknown,
  scope?: string,
): string {
  let inputDigest: string
  try {
    inputDigest = canonicalInputDigest(input)
  } catch {
    inputDigest = uniqueSerializationFailureDigest()
  }
  return [
    SIGNATURE_VERSION,
    scopeDigest(scope),
    digestText('repeated-failure-tool-v2', toolName),
    inputDigest,
  ].join(':')
}

function isSha256Digest(value: string | undefined): value is string {
  return (
    value?.length === SHA256_HEX_LENGTH && /^[0-9a-f]+$/.test(value)
  )
}

function signatureStorageIdentity(signature: string): {
  key: string
  scope: string
} {
  if (
    signature.length === UNSCOPED_SIGNATURE_LENGTH ||
    signature.length === SCOPED_SIGNATURE_LENGTH
  ) {
    const parts = signature.split(':')
    if (
      parts.length === 4 &&
      parts[0] === SIGNATURE_VERSION &&
      (parts[1] === UNSCOPED_DIGEST ||
        isSha256Digest(parts[1])) &&
      isSha256Digest(parts[2]) &&
      isSha256Digest(parts[3])
    ) {
      return { key: signature, scope: parts[1] }
    }
  }
  // Keep compatibility with callers/tests that supply their own opaque
  // signature while still preventing an arbitrarily large key from being
  // retained in guard state.
  return {
    key: `${SIGNATURE_VERSION}:legacy:${digestText(
      'repeated-failure-legacy-signature-v2',
      signature,
    )}`,
    scope: UNSCOPED_DIGEST,
  }
}

function pruneExpiredFailures(now: number): void {
  for (const [signature, record] of failureCounts) {
    if (
      now >= record.lastFailureAt &&
      now - record.lastFailureAt >=
        REPEATED_FAILURE_GUARD_LIMITS.entryTtlMs
    ) {
      failureCounts.delete(signature)
    }
  }
}

function enforceFailureBounds(scope: string): void {
  let entriesInScope = 0
  for (const record of failureCounts.values()) {
    if (record.scopeDigest === scope) entriesInScope++
  }

  let scopeOverflow =
    entriesInScope - REPEATED_FAILURE_GUARD_LIMITS.maxEntriesPerScope
  if (scopeOverflow > 0) {
    for (const [signature, record] of failureCounts) {
      if (record.scopeDigest !== scope) continue
      failureCounts.delete(signature)
      scopeOverflow--
      if (scopeOverflow === 0) break
    }
  }

  while (failureCounts.size > REPEATED_FAILURE_GUARD_LIMITS.maxEntries) {
    const oldest = failureCounts.keys().next().value
    if (oldest === undefined) break
    failureCounts.delete(oldest)
  }
}

export function recordCallFailure(signature: string): number {
  const now = repeatedFailureNow()
  pruneExpiredFailures(now)
  const identity = signatureStorageIdentity(signature)
  const existing = failureCounts.get(identity.key)
  const next = (existing?.failures ?? 0) + 1
  const signatureScope = existing?.scopeDigest ?? identity.scope

  // Refresh insertion order so frequently retried calls are retained while
  // stale one-off failures from old query chains can be evicted.
  failureCounts.delete(identity.key)
  failureCounts.set(identity.key, {
    failures: next,
    lastFailureAt: now,
    scopeDigest: signatureScope,
  })
  enforceFailureBounds(signatureScope)
  return next
}

/** A call that worked clears its own history, so a later failure starts fresh. */
export function recordCallSuccess(signature: string): void {
  failureCounts.delete(signatureStorageIdentity(signature).key)
}

/** Clear every retained failure belonging to one exact runtime scope. */
export function clearRepeatedFailuresForScope(scope: string): number {
  const target = scopeDigest(scope)
  let cleared = 0
  for (const [signature, record] of failureCounts) {
    if (record.scopeDigest !== target) continue
    failureCounts.delete(signature)
    cleared++
  }
  return cleared
}

/**
 * Query owners should call this once, in their outer completion/finally path.
 * It accepts the raw chain id and applies the same `query:` namespace used by
 * toolExecution's repeatedFailureScope helper.
 */
export function clearRepeatedFailuresForQuery(queryChainId: string): number {
  return clearRepeatedFailuresForScope(`query:${queryChainId}`)
}

export type RepeatDecision =
  | { action: 'allow' }
  | { action: 'refuse'; reason: string }
  | { action: 'abort'; reason: string }

/**
 * Distinguishes the guard's deliberate turn abort from an ordinary tool
 * failure. runToolUse must let this escape instead of converting it into yet
 * another retryable tool_result.
 */
export class RepeatedToolFailureAbort extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RepeatedToolFailureAbort'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export function checkRepeatedFailure(
  signature: string,
  config: RepeatedFailureConfig = REPEATED_FAILURE_DEFAULTS,
): RepeatDecision {
  if (!config.enabled) return { action: 'allow' }
  const now = repeatedFailureNow()
  pruneExpiredFailures(now)
  const failures =
    failureCounts.get(signatureStorageIdentity(signature).key)?.failures ?? 0
  if (failures >= config.abortAfter) {
    return {
      action: 'abort',
      reason:
        `This exact call has failed ${failures} times and is still being ` +
        `repeated. Stopping the turn rather than continuing to loop.`,
    }
  }
  if (failures >= config.limit) {
    const recoveryHint = config.recoveryHint
      ? ` ${config.recoveryHint.trim()}`
      : ''
    return {
      action: 'refuse',
      reason:
        `This exact call has already failed ${failures} times with the same ` +
        `arguments, so it will fail again. Do not retry it unchanged. Either ` +
        `fix the arguments, use a different tool, or tell the user what is ` +
        `blocking you and stop.${recoveryHint}`,
    }
  }
  return { action: 'allow' }
}
