import { expect, test } from 'bun:test'
import {
  detectPii,
  evaluateDeterministicRule,
  evaluateGuardrails,
  guardrailFindings,
  ruleAppliesTo,
  validateGuardrails,
  type GuardrailConfig,
  type GuardrailRule,
} from '../src/services/guardrails/guardrails.ts'

test('detectPii recognizes common identifiers', () => {
  expect(detectPii('reach me at a@b.com')).toContain('email')
  expect(detectPii('ssn 123-45-6789')).toContain('ssn')
  expect(detectPii('key AKIA1234567890ABCD12')).toContain('aws-key')
  expect(detectPii('nothing here')).toEqual([])
})

test('evaluateDeterministicRule handles each non-LLM kind', () => {
  expect(
    evaluateDeterministicRule({ id: 'r', kind: 'contains', pattern: 'TODO' }, 'has TODO'),
  ).not.toBeNull()
  expect(
    evaluateDeterministicRule({ id: 'r', kind: 'regex', pattern: 'a\\d+' }, 'a42'),
  ).not.toBeNull()
  expect(
    evaluateDeterministicRule({ id: 'r', kind: 'maxLength', max: 3 }, 'abcd'),
  ).not.toBeNull()
  expect(
    evaluateDeterministicRule({ id: 'r', kind: 'maxLength', max: 8 }, 'abcd'),
  ).toBeNull()
})

test('jsonSchema rule fails invalid JSON and schema mismatches', () => {
  const rule: GuardrailRule = {
    id: 'shape',
    kind: 'jsonSchema',
    schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
  }
  expect(evaluateDeterministicRule(rule, 'not json')).not.toBeNull()
  expect(evaluateDeterministicRule(rule, '{"ok":"yes"}')).not.toBeNull()
  expect(evaluateDeterministicRule(rule, '{"ok":true}')).toBeNull()
})

test('ruleAppliesTo respects phase and tool scoping', () => {
  const rule: GuardrailRule = { id: 'r', kind: 'contains', pattern: 'x', phase: 'input', tools: ['Bash'] }
  expect(ruleAppliesTo(rule, 'Bash', 'input')).toBe(true)
  expect(ruleAppliesTo(rule, 'Bash', 'output')).toBe(false)
  expect(ruleAppliesTo(rule, 'WebFetch', 'input')).toBe(false)
})

test('evaluateGuardrails trips the wire only on block-action violations', async () => {
  const config: GuardrailConfig = {
    version: 1,
    rules: [
      { id: 'warn-pii', kind: 'pii', action: 'warn', pii: ['email'] },
      { id: 'block-key', kind: 'regex', action: 'block', pattern: 'AKIA[0-9A-Z]{16}' },
    ],
  }
  const warnOnly = await evaluateGuardrails(config, 'mail a@b.com')
  expect(warnOnly.tripwire).toBe(false)
  expect(warnOnly.violations).toHaveLength(1)

  const blocked = await evaluateGuardrails(config, 'AKIA1234567890ABCD12')
  expect(blocked.tripwire).toBe(true)
})

test('evaluateGuardrails grades llm rules through the injected judge', async () => {
  const config: GuardrailConfig = {
    version: 1,
    rules: [{ id: 'tone', kind: 'llm', action: 'block', rubric: 'no insults' }],
  }
  const decision = await evaluateGuardrails(config, 'you are dumb', {
    judge: async () => ({ output: 'VERDICT: FAIL rude', verdict: 'FAIL', isError: false }),
  })
  expect(decision.tripwire).toBe(true)
  expect(decision.violations[0]!.kind).toBe('llm')
})

test('guardrailFindings scans added diff lines and maps severity', () => {
  const config: GuardrailConfig = {
    version: 1,
    rules: [
      { id: 'no-fixme', kind: 'contains', action: 'warn', pattern: 'FIXME' },
      { id: 'no-key', kind: 'regex', action: 'block', pattern: 'AKIA[0-9A-Z]{16}' },
    ],
  }
  const diff = [
    '+++ b/app.ts',
    '@@ -0,0 +1,2 @@',
    '+const k = "AKIA1234567890ABCD12" // FIXME',
    '-removed',
    ' context only',
  ].join('\n')
  const findings = guardrailFindings(diff, config)
  expect(findings.map(f => f.rule).sort()).toEqual(['guardrail:no-fixme', 'guardrail:no-key'])
  expect(findings.find(f => f.rule === 'guardrail:no-key')!.severity).toBe('block')
})

test('validateGuardrails reports structural errors', () => {
  const v = validateGuardrails({
    version: 1,
    rules: [
      { id: 'bad id!', kind: 'regex' } as GuardrailRule,
      { id: 'dup', kind: 'maxLength' } as GuardrailRule,
      { id: 'dup', kind: 'contains', pattern: 'x' },
    ],
  })
  expect(v.valid).toBe(false)
  expect(v.errors.some(e => e.includes('invalid rule id'))).toBe(true)
  expect(v.errors.some(e => e.includes('needs a pattern'))).toBe(true)
  expect(v.errors.some(e => e.includes('duplicate'))).toBe(true)
})
