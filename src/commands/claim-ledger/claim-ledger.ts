import { join } from 'node:path'
import type {
  LocalCommandCall,
  LocalCommandResult,
} from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'
import { safeParseJSON } from '../../utils/json.js'
import {
  readPrivateText,
  withPrivateStateLock,
  writePrivateTextAtomic,
} from '../../utils/privateState.js'

type ClaimSource = { kind: string; ref: string; accessedAt?: string }
type Claim = {
  id: string
  claim: string
  confidence: 'low' | 'medium' | 'high'
  sources: ClaimSource[]
  createdAt: string
}
type Ledger = { claims: Claim[] }
type LoadedLedger =
  | { ok: true; ledger: Ledger }
  | { ok: false; errors: string[] }

const CONFIDENCE_VALUES = new Set<Claim['confidence']>([
  'low',
  'medium',
  'high',
])
const SOURCE_KINDS = new Set(['web', 'file', 'mcp', 'tool', 'user'])
const MAX_LEDGER_BYTES = 2 * 1024 * 1024

function ledgerRoot(): string {
  return join(getCwd(), '.ur')
}

function ledgerPath(): string {
  return join(ledgerRoot(), 'evidence', 'claims.json')
}

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  return index === -1 ? undefined : tokens[index + 1]
}

function validateLedger(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return ['ledger root must be an object']
  }
  const claims = (value as { claims?: unknown }).claims
  if (!Array.isArray(claims)) return ['ledger.claims must be an array']

  const errors: string[] = []
  const ids = new Set<string>()
  for (let index = 0; index < claims.length; index++) {
    const raw = claims[index]
    const label = `claims[${index}]`
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(`${label} must be an object`)
      continue
    }
    const claim = raw as Partial<Claim>
    if (typeof claim.id !== 'string' || !claim.id.trim()) {
      errors.push(`${label}.id must be a non-empty string`)
    } else if (ids.has(claim.id)) {
      errors.push(`${label}.id is duplicated: ${claim.id}`)
    } else {
      ids.add(claim.id)
    }
    if (typeof claim.claim !== 'string' || !claim.claim.trim()) {
      errors.push(`${label}.claim must be a non-empty string`)
    }
    if (
      typeof claim.confidence !== 'string' ||
      !CONFIDENCE_VALUES.has(claim.confidence as Claim['confidence'])
    ) {
      errors.push(`${label}.confidence must be low, medium, or high`)
    }
    if (typeof claim.createdAt !== 'string' || !claim.createdAt.trim()) {
      errors.push(`${label}.createdAt must be a non-empty string`)
    }
    if (!Array.isArray(claim.sources) || claim.sources.length === 0) {
      errors.push(`${label}.sources must be a non-empty array`)
      continue
    }
    for (let sourceIndex = 0; sourceIndex < claim.sources.length; sourceIndex++) {
      const source = claim.sources[sourceIndex]
      const sourceLabel = `${label}.sources[${sourceIndex}]`
      if (!source || typeof source !== 'object' || Array.isArray(source)) {
        errors.push(`${sourceLabel} must be an object`)
        continue
      }
      if (
        typeof source.kind !== 'string' ||
        !SOURCE_KINDS.has(source.kind)
      ) {
        errors.push(`${sourceLabel}.kind is unsupported`)
      }
      if (typeof source.ref !== 'string' || !source.ref.trim()) {
        errors.push(`${sourceLabel}.ref must be a non-empty string`)
      }
      if (
        source.accessedAt !== undefined &&
        typeof source.accessedAt !== 'string'
      ) {
        errors.push(`${sourceLabel}.accessedAt must be a string when present`)
      }
    }
  }
  return errors
}

function loadLedger(): LoadedLedger {
  let raw: string | null
  try {
    raw = readPrivateText(ledgerRoot(), ledgerPath(), MAX_LEDGER_BYTES)
  } catch (error) {
    return {
      ok: false,
      errors: [
        `could not safely read ledger: ${error instanceof Error ? error.message : String(error)}`,
      ],
    }
  }
  if (raw === null) return { ok: true, ledger: { claims: [] } }
  const parsed = safeParseJSON(raw, false)
  const errors = validateLedger(parsed)
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, ledger: parsed as Ledger }
}

function saveLedger(ledger: Ledger): void {
  writePrivateTextAtomic(
    ledgerRoot(),
    ledgerPath(),
    `${JSON.stringify(ledger, null, 2)}\n`,
    MAX_LEDGER_BYTES,
  )
}

function loadFailureResult(
  loaded: Extract<LoadedLedger, { ok: false }>,
  json: boolean,
): LocalCommandResult {
  return {
    type: 'text',
    value: json
      ? JSON.stringify(
          { valid: false, path: ledgerPath(), errors: loaded.errors },
          null,
          2,
        )
      : `Claim ledger is invalid at ${ledgerPath()}:\n${loaded.errors.map(error => `- ${error}`).join('\n')}`,
    exitCode: 1,
  }
}

function nextClaimId(ledger: Ledger): string {
  const used = new Set(ledger.claims.map(claim => claim.id))
  let candidate = 1
  while (used.has(String(candidate))) candidate += 1
  return String(candidate)
}

function parseSource(value: string | undefined): ClaimSource | null {
  if (!value) return null
  const index = value.indexOf(':')
  if (index === -1) {
    return value.trim()
      ? {
          kind: 'user',
          ref: value.trim(),
          accessedAt: new Date().toISOString(),
        }
      : null
  }
  const kind = value.slice(0, index).trim()
  const ref = value.slice(index + 1).trim()
  if (!SOURCE_KINDS.has(kind) || !ref) return null
  return {
    kind,
    ref,
    accessedAt: new Date().toISOString(),
  }
}

function usage(): string {
  return [
    'Usage:',
    '  ur claim-ledger list [--json]',
    '  ur claim-ledger validate [--json]',
    '  ur claim-ledger add --claim "..." --source web:https://example.com [--confidence low|medium|high]',
  ].join('\n')
}

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const command = tokens.find(token => !token.startsWith('--')) ?? 'list'

  if (command === 'add') {
    const claimText = option(tokens, '--claim')
    const source = parseSource(option(tokens, '--source'))
    if (!claimText?.trim() || !source) {
      return { type: 'text', value: usage(), exitCode: 2 }
    }
    const confidence = option(tokens, '--confidence') ?? 'medium'
    if (!CONFIDENCE_VALUES.has(confidence as Claim['confidence'])) {
      return {
        type: 'text',
        value: '--confidence must be low, medium, or high.',
        exitCode: 2,
      }
    }
    try {
      return withPrivateStateLock(ledgerRoot(), 'claim-ledger', () => {
        // Loading and saving must be one transaction. Atomic rename protects
        // readers from partial JSON, while this cross-process lock prevents
        // parallel agents from both reading the same old ledger and losing one
        // another's claim on the subsequent rename.
        const loaded = loadLedger()
        if (loaded.ok === false) return loadFailureResult(loaded, json)
        const ledger = loaded.ledger
        const claim: Claim = {
          id: nextClaimId(ledger),
          claim: claimText.trim(),
          confidence: confidence as Claim['confidence'],
          sources: [source],
          createdAt: new Date().toISOString(),
        }
        ledger.claims.push(claim)
        saveLedger(ledger)
        return {
          type: 'text',
          value: json
            ? JSON.stringify(claim, null, 2)
            : `Added claim ${claim.id}`,
        }
      })
    } catch (error) {
      return {
        type: 'text',
        value: `Could not safely write claim ledger: ${error instanceof Error ? error.message : String(error)}`,
        exitCode: 1,
      }
    }
  }

  const loaded = loadLedger()
  if (loaded.ok === false) {
    return loadFailureResult(loaded, json)
  }
  const ledger = loaded.ledger

  if (command === 'validate') {
    return {
      type: 'text',
      value: json
        ? JSON.stringify({ valid: true, errors: [] }, null, 2)
        : 'Claim ledger is valid.',
    }
  }

  if (command === 'list') {
    return {
      type: 'text',
      value: JSON.stringify(ledger, null, 2),
    }
  }

  return { type: 'text', value: usage(), exitCode: 2 }
}
