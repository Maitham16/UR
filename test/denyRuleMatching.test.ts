import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import ignore from 'ignore'

// matchingRuleForInput resolved which permission rule matches a path by reading
// `igResult.rule.pattern` from the result of ignore().test(). That property does
// not exist: TestResult is { ignored, unignored }. The access sat behind an
// `igResult.rule` guard, so the guard was always false, the function returned
// null unconditionally, and every caller — FileWriteTool, FileEditTool,
// FileReadTool, PowerShell path validation, attachments — does:
//
//     const denyRule = matchingRuleForInput(path, ctx, kind, 'deny')
//     if (denyRule) { return { behavior: 'deny' } }
//
// so explicit file deny rules were never enforced. filesystem.ts carries
// @ts-nocheck, which is why tsc never reported the missing property.

test('the ignore library really does not expose a matched rule', () => {
  // The whole defect rests on this. If a future version adds `rule`, the
  // per-pattern loop is still correct, but this documents why it exists.
  const result = ignore().add(['secrets']).test('secrets/key.txt')
  expect(result.ignored).toBe(true)
  expect(Object.keys(result).sort()).toEqual(['ignored', 'unignored'])
  expect((result as unknown as Record<string, unknown>).rule).toBeUndefined()
})

/**
 * Comments quote the removed expression to explain the defect, so a raw grep
 * matches the explanation and fails on correct code. Strip comments first and
 * assert against executable source only.
 */
function codeWithoutComments(file: string): string {
  // Line comments only. Stripping /* */ as well removed half this file: it is
  // full of gitignore patterns like '/**' and '/.ur/**', and the `/*` inside
  // those string literals opens a block comment that runs to the next `*/`.
  // A whole-line `//` match is safe — `path.startsWith('//')` does not begin
  // a line, and the expression under test only ever appears in `//` comments.
  return readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '')
}

test('the dead property access is gone from the executable source', () => {
  const code = codeWithoutComments('src/utils/permissions/filesystem.ts')
  expect(code).not.toContain('igResult.rule')
  expect(code).not.toMatch(/\.rule\.pattern/)
})

test('the comment-stripping is real, not a way to pass vacuously', () => {
  // If the stripper ate everything, the test above would pass on any file.
  const code = codeWithoutComments('src/utils/permissions/filesystem.ts')
  expect(code).toContain('export function matchingRuleForInput')
  expect(code).toContain('ignore()')
  // And it must actually remove a line comment that quotes the banned string.
  expect(codeWithoutComments.length).toBeGreaterThan(0)
  const sample = '// see igResult.rule.pattern\nconst x = 1\n'
  expect(sample.replace(/^\s*\/\/.*$/gm, '')).not.toContain('igResult.rule')
})

/** The resolution strategy now used by matchingRuleForInput. */
function resolveRule<T>(
  patternMap: Map<string, T>,
  relativePath: string,
): T | null {
  const patterns = [...patternMap.keys()].map(p =>
    p.endsWith('/**') ? p.slice(0, -3) : p,
  )
  if (!ignore().add(patterns).test(relativePath).ignored) return null
  for (const [original, rule] of patternMap.entries()) {
    const adjusted = original.endsWith('/**')
      ? original.slice(0, -3)
      : original
    if (!adjusted) continue
    if (ignore().add(adjusted).test(relativePath).ignored) return rule
  }
  return null
}

test('a denied path resolves to the rule that denied it', () => {
  const rules = new Map([
    ['secrets/**', 'deny-secrets'],
    ['*.pem', 'deny-pem'],
    ['config/prod.json', 'deny-prod'],
  ])
  expect(resolveRule(rules, 'secrets/key.txt')).toBe('deny-secrets')
  expect(resolveRule(rules, 'server.pem')).toBe('deny-pem')
  expect(resolveRule(rules, 'config/prod.json')).toBe('deny-prod')
})

test('a path matching nothing still resolves to null', () => {
  // The bug made everything return null, so "returns null" alone proves
  // nothing — the negative case has to be checked alongside the positive.
  const rules = new Map([['secrets/**', 'deny-secrets']])
  expect(resolveRule(rules, 'src/app.ts')).toBeNull()
})

test('a /** directory pattern matches the directory and its contents', () => {
  const rules = new Map([['secrets/**', 'deny-secrets']])
  expect(resolveRule(rules, 'secrets')).toBe('deny-secrets')
  expect(resolveRule(rules, 'secrets/nested/deep.txt')).toBe('deny-secrets')
})

test('an empty pattern never matches everything', () => {
  // A bare "/**" reduces to "" after the suffix strip. Passing that to
  // ignore().add() would be a rule that denies every path.
  const rules = new Map([['/**', 'deny-all'], ['*.pem', 'deny-pem']])
  expect(resolveRule(rules, 'server.pem')).toBe('deny-pem')
})
