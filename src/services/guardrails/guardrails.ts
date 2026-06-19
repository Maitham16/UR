/**
 * Declarative guardrails layer.
 *
 * UR's safety has been real but imperative (permission rules, the self-review
 * gate, secret scanning). This adds a composable, declarative layer on top:
 * rules in `.ur/guardrails/` validate tool input/output and can trip a wire that
 * blocks the action. Deterministic checks (regex, substring, PII, length, JSON
 * schema) are pure and unit-tested; the optional `llm` rule is graded behind an
 * injectable runner, so the engine stays offline-testable. Mirrors the OpenAI
 * Agents SDK input/output/tool guardrails, local-first. The deterministic subset
 * also emits self-review findings, so guardrails compose with the PR gate.
 */

import { Ajv } from 'ajv'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type { ReviewFinding } from '../../commands/agent-task/selfReview.js'
import {
  defaultHeadlessRunner,
  makeDryHeadlessRunner,
  type HeadlessRunner,
} from '../agents/headlessAgent.js'
import { safeParseJSON } from '../../utils/json.js'

export type GuardrailKind =
  | 'regex'
  | 'contains'
  | 'pii'
  | 'maxLength'
  | 'jsonSchema'
  | 'llm'
export type GuardrailPhase = 'input' | 'output' | 'both'
export type GuardrailAction = 'block' | 'warn'

export type PiiKind = 'email' | 'ssn' | 'credit-card' | 'phone' | 'jwt' | 'aws-key'

export type GuardrailRule = {
  id: string
  description?: string
  kind: GuardrailKind
  /** Which side of a tool call this rule guards. Default: both. */
  phase?: GuardrailPhase
  /** block trips the wire (halts); warn is advisory. Default: block. */
  action?: GuardrailAction
  /** Restrict to these tool names (by primary name). Empty/absent = all tools. */
  tools?: string[]
  /** regex / contains pattern. */
  pattern?: string
  /** regex flags (default "i"). */
  flags?: string
  /** pii kinds to detect, or "all". */
  pii?: PiiKind[] | 'all'
  /** maxLength budget. */
  max?: number
  /** JSON schema the (parsed) text must satisfy. */
  schema?: Record<string, unknown>
  /** llm rubric; the text passes when the judge says PASS. */
  rubric?: string
}

export type GuardrailConfig = { version: 1; rules: GuardrailRule[] }

export type GuardrailViolation = {
  ruleId: string
  kind: GuardrailKind
  action: GuardrailAction
  message: string
}

export type GuardrailDecision = {
  /** True when at least one `block` rule fired — the caller must halt. */
  tripwire: boolean
  violations: GuardrailViolation[]
}

const PII_PATTERNS: Record<PiiKind, RegExp> = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/,
  'credit-card': /\b(?:\d[ -]?){13,16}\b/,
  phone: /\b(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}\b/,
  jwt: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  'aws-key': /\bAKIA[0-9A-Z]{16}\b/,
}

const ALL_PII = Object.keys(PII_PATTERNS) as PiiKind[]

export function detectPii(text: string, kinds: PiiKind[] | 'all' = 'all'): PiiKind[] {
  const wanted = kinds === 'all' ? ALL_PII : kinds
  return wanted.filter(kind => PII_PATTERNS[kind].test(text))
}

const ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/i

export function validateGuardrails(config: GuardrailConfig): {
  valid: boolean
  errors: string[]
  warnings: string[]
} {
  const errors: string[] = []
  const warnings: string[] = []
  if (!Array.isArray(config.rules)) {
    return { valid: false, errors: ['config has no rules array'], warnings }
  }
  const seen = new Set<string>()
  for (const rule of config.rules) {
    if (!ID_RE.test(rule.id ?? '')) errors.push(`invalid rule id "${rule.id}"`)
    if (seen.has(rule.id)) errors.push(`duplicate rule id "${rule.id}"`)
    seen.add(rule.id)
    if ((rule.kind === 'regex' || rule.kind === 'contains') && !rule.pattern) {
      errors.push(`rule "${rule.id}" (${rule.kind}) needs a pattern`)
    }
    if (rule.kind === 'regex' && rule.pattern) {
      try {
        new RegExp(rule.pattern, rule.flags ?? 'i')
      } catch {
        errors.push(`rule "${rule.id}" has an invalid regex`)
      }
    }
    if (rule.kind === 'maxLength' && typeof rule.max !== 'number') {
      errors.push(`rule "${rule.id}" (maxLength) needs a numeric max`)
    }
    if (rule.kind === 'jsonSchema' && !rule.schema) {
      errors.push(`rule "${rule.id}" (jsonSchema) needs a schema`)
    }
    if (rule.kind === 'llm' && !rule.rubric) {
      errors.push(`rule "${rule.id}" (llm) needs a rubric`)
    }
  }
  return { valid: errors.length === 0, errors, warnings }
}

function action(rule: GuardrailRule): GuardrailAction {
  return rule.action ?? 'block'
}

export function ruleAppliesTo(
  rule: GuardrailRule,
  toolName: string | undefined,
  phase: GuardrailPhase,
): boolean {
  const rulePhase = rule.phase ?? 'both'
  if (rulePhase !== 'both' && phase !== 'both' && rulePhase !== phase) return false
  if (rule.tools && rule.tools.length > 0) {
    if (!toolName || !rule.tools.includes(toolName)) return false
  }
  return true
}

/** Evaluate a deterministic (non-LLM) rule. Returns a violation or null. Pure. */
export function evaluateDeterministicRule(
  rule: GuardrailRule,
  text: string,
): GuardrailViolation | null {
  const violation = (message: string): GuardrailViolation => ({
    ruleId: rule.id,
    kind: rule.kind,
    action: action(rule),
    message,
  })
  switch (rule.kind) {
    case 'contains':
      return rule.pattern && text.toLowerCase().includes(rule.pattern.toLowerCase())
        ? violation(rule.description ?? `matched forbidden text "${rule.pattern}"`)
        : null
    case 'regex': {
      if (!rule.pattern) return null
      let re: RegExp
      try {
        re = new RegExp(rule.pattern, rule.flags ?? 'i')
      } catch {
        return null
      }
      return re.test(text)
        ? violation(rule.description ?? `matched /${rule.pattern}/`)
        : null
    }
    case 'pii': {
      const found = detectPii(text, rule.pii ?? 'all')
      return found.length > 0
        ? violation(rule.description ?? `PII detected: ${found.join(', ')}`)
        : null
    }
    case 'maxLength':
      return typeof rule.max === 'number' && text.length > rule.max
        ? violation(rule.description ?? `exceeds ${rule.max} chars (${text.length})`)
        : null
    case 'jsonSchema': {
      if (!rule.schema) return null
      const parsed = safeParseJSON(text, false)
      if (parsed === false || parsed === null || typeof parsed !== 'object') {
        return violation(rule.description ?? 'output is not valid JSON')
      }
      const ajv = new Ajv({ allErrors: true })
      let validate: ReturnType<Ajv['compile']>
      try {
        validate = ajv.compile(rule.schema)
      } catch {
        return null
      }
      return validate(parsed)
        ? null
        : violation(rule.description ?? `schema: ${ajv.errorsText(validate.errors)}`)
    }
    default:
      return null
  }
}

export type EvaluateOptions = {
  toolName?: string
  phase?: GuardrailPhase
  judge?: HeadlessRunner
  dryRun?: boolean
}

/** Evaluate all applicable rules against text. LLM rules use the injected runner. */
export async function evaluateGuardrails(
  config: GuardrailConfig,
  text: string,
  options: EvaluateOptions = {},
): Promise<GuardrailDecision> {
  const phase = options.phase ?? 'both'
  const violations: GuardrailViolation[] = []
  for (const rule of config.rules) {
    if (!ruleAppliesTo(rule, options.toolName, phase)) continue
    if (rule.kind === 'llm') {
      if (!rule.rubric) continue
      const runner =
        options.judge ?? (options.dryRun ? makeDryHeadlessRunner() : defaultHeadlessRunner())
      const out = await runner({
        cwd: process.cwd(),
        prompt:
          `You are a guardrail. Decide if the TEXT violates this policy.\n\n` +
          `Policy: ${rule.rubric}\n\nTEXT:\n${text.slice(0, 4000)}\n\n` +
          `Reply with exactly "VERDICT: PASS" (no violation) or "VERDICT: FAIL" (violation), then a brief reason.`,
        maxTurns: 1,
      })
      if (/\bVERDICT:\s*FAIL\b/i.test(out.output)) {
        violations.push({
          ruleId: rule.id,
          kind: 'llm',
          action: action(rule),
          message: rule.description ?? `llm guardrail failed: ${rule.rubric}`,
        })
      }
      continue
    }
    const violation = evaluateDeterministicRule(rule, text)
    if (violation) violations.push(violation)
  }
  return { tripwire: violations.some(v => v.action === 'block'), violations }
}

/** Extract added (`+`) lines from a unified diff, ignoring file headers. */
function addedLines(diff: string): string {
  return diff
    .split('\n')
    .filter(line => line.startsWith('+') && !line.startsWith('+++'))
    .map(line => line.slice(1))
    .join('\n')
}

/**
 * Self-review findings from the deterministic guardrails (regex/contains/pii/
 * maxLength). Lets guardrails compose with `ur agent-task pr`'s self-review gate.
 */
export function guardrailFindings(
  diff: string,
  config: GuardrailConfig,
  options: { addedOnly?: boolean } = {},
): ReviewFinding[] {
  const text = options.addedOnly === false ? diff : addedLines(diff)
  const findings: ReviewFinding[] = []
  for (const rule of config.rules) {
    if (rule.kind === 'llm' || rule.kind === 'jsonSchema') continue
    if (!ruleAppliesTo(rule, undefined, 'output')) continue
    const violation = evaluateDeterministicRule(rule, text)
    if (!violation) continue
    findings.push({
      severity: violation.action === 'block' ? 'block' : 'warn',
      rule: `guardrail:${rule.id}`,
      message: violation.message,
    })
  }
  return findings
}

export function guardrailsDir(cwd: string): string {
  return join(cwd, '.ur', 'guardrails')
}

/** Load and merge every `*.json` rule file under `.ur/guardrails/`. */
export function loadGuardrails(cwd: string): GuardrailConfig {
  const dir = guardrailsDir(cwd)
  if (!existsSync(dir)) return { version: 1, rules: [] }
  const rules: GuardrailRule[] = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    const parsed = safeParseJSON(readFileSync(join(dir, file), 'utf-8'), false)
    if (!parsed || typeof parsed !== 'object') continue
    const fileRules = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as GuardrailConfig).rules)
        ? (parsed as GuardrailConfig).rules
        : []
    for (const rule of fileRules) if (rule && typeof rule === 'object') rules.push(rule)
  }
  return { version: 1, rules }
}

export function defaultGuardrails(): GuardrailConfig {
  return {
    version: 1,
    rules: [
      {
        id: 'no-private-keys',
        kind: 'regex',
        action: 'block',
        phase: 'output',
        description: 'Private key material must not be written',
        pattern: '-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----',
      },
      {
        id: 'no-pii-leak',
        kind: 'pii',
        action: 'warn',
        phase: 'output',
        pii: ['ssn', 'credit-card'],
        description: 'Possible PII (SSN / credit card) in output',
      },
      {
        id: 'block-rm-rf-root',
        kind: 'regex',
        action: 'block',
        phase: 'input',
        tools: ['Bash'],
        description: 'Refuse destructive recursive deletes of the filesystem root',
        pattern: 'rm\\s+-rf?\\s+(?:/|~|\\$HOME)(?:\\s|$)',
      },
    ],
  }
}

export function scaffoldGuardrails(
  cwd: string,
  options: { force?: boolean } = {},
): { path: string; created: boolean } {
  const dir = guardrailsDir(cwd)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'default.json')
  if (existsSync(path) && options.force !== true) return { path, created: false }
  writeFileSync(path, `${JSON.stringify(defaultGuardrails(), null, 2)}\n`)
  return { path, created: true }
}

export function formatDecision(decision: GuardrailDecision, json: boolean): string {
  if (json) return JSON.stringify(decision, null, 2)
  if (decision.violations.length === 0) return 'Guardrails: no violations.'
  const lines = [decision.tripwire ? 'Guardrails: TRIPWIRE (blocked)' : 'Guardrails: warnings']
  for (const v of decision.violations) {
    lines.push(`  - [${v.action}] ${v.ruleId} (${v.kind}): ${v.message}`)
  }
  return lines.join('\n')
}
