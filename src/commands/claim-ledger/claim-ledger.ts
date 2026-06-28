import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'
import { safeParseJSON } from '../../utils/json.js'

type ClaimSource = { kind: string; ref: string; accessedAt?: string }
type Claim = {
  id: string
  claim: string
  confidence: 'low' | 'medium' | 'high'
  sources: ClaimSource[]
  createdAt: string
}
type Ledger = { claims: Claim[] }

function ledgerPath(): string {
  return join(getCwd(), '.ur', 'evidence', 'claims.json')
}

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  return index === -1 ? undefined : tokens[index + 1]
}

function loadLedger(): Ledger {
  if (!existsSync(ledgerPath())) return { claims: [] }
  const parsed = safeParseJSON(readFileSync(ledgerPath(), 'utf-8'), false)
  return parsed && typeof parsed === 'object' && Array.isArray((parsed as Ledger).claims)
    ? (parsed as Ledger)
    : { claims: [] }
}

function saveLedger(ledger: Ledger): void {
  mkdirSync(join(getCwd(), '.ur', 'evidence'), { recursive: true })
  writeFileSync(ledgerPath(), `${JSON.stringify(ledger, null, 2)}\n`)
}

function parseSource(value: string | undefined): ClaimSource | null {
  if (!value) return null
  const index = value.indexOf(':')
  if (index === -1) return { kind: 'user', ref: value, accessedAt: new Date().toISOString() }
  return {
    kind: value.slice(0, index),
    ref: value.slice(index + 1),
    accessedAt: new Date().toISOString(),
  }
}

function validate(ledger: Ledger): string[] {
  const errors: string[] = []
  for (const claim of ledger.claims) {
    if (!claim.claim.trim()) errors.push(`${claim.id}: empty claim`)
    if (claim.sources.length === 0) errors.push(`${claim.id}: no sources`)
    for (const source of claim.sources) {
      if (!source.kind || !source.ref) errors.push(`${claim.id}: malformed source`)
    }
  }
  return errors
}

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const command = tokens.find(token => !token.startsWith('--')) ?? 'list'
  const ledger = loadLedger()

  if (command === 'add') {
    const claimText = option(tokens, '--claim')
    const source = parseSource(option(tokens, '--source'))
    if (!claimText || !source) {
      return { type: 'text', value: 'Usage: ur claim-ledger add --claim "..." --source web:https://example.com' }
    }
    const confidence = (option(tokens, '--confidence') ?? 'medium') as Claim['confidence']
    const claim: Claim = {
      id: String(ledger.claims.length + 1),
      claim: claimText,
      confidence: ['low', 'medium', 'high'].includes(confidence) ? confidence : 'medium',
      sources: [source],
      createdAt: new Date().toISOString(),
    }
    ledger.claims.push(claim)
    saveLedger(ledger)
    return { type: 'text', value: json ? JSON.stringify(claim, null, 2) : `Added claim ${claim.id}` }
  }

  if (command === 'validate') {
    const errors = validate(ledger)
    return {
      type: 'text',
      value: json
        ? JSON.stringify({ valid: errors.length === 0, errors }, null, 2)
        : errors.length === 0
          ? 'Claim ledger is valid.'
          : errors.join('\n'),
    }
  }

  return {
    type: 'text',
    value: json ? JSON.stringify(ledger, null, 2) : JSON.stringify(ledger, null, 2),
  }
}
