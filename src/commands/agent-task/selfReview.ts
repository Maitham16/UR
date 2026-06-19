/**
 * Deterministic self-review of a unified diff, run as a gate before
 * `ur agent-task pr --create` opens a PR. This mirrors how Copilot reviews its
 * own diff before opening a PR — catching issues that should never reach review
 * (conflict markers, secrets, focused tests) plus lower-severity smells.
 *
 * Pure and dependency-free so it is fast and unit-testable. It is heuristic,
 * not a substitute for the model-driven `/code-review`; it is the automatic
 * safety net on the PR path.
 */

export type ReviewSeverity = 'block' | 'warn' | 'info'

export type ReviewFinding = {
  severity: ReviewSeverity
  rule: string
  message: string
  file?: string
  line?: number
}

type Rule = {
  rule: string
  severity: ReviewSeverity
  message: string
  test: RegExp
}

// Each rule runs against newly added lines only (the diff's `+` lines).
const RULES: Rule[] = [
  {
    rule: 'merge-conflict',
    severity: 'block',
    message: 'Unresolved merge conflict marker',
    test: /^(<{7}|={7}|>{7})( |$)/,
  },
  {
    rule: 'private-key',
    severity: 'block',
    message: 'Private key material committed',
    test: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/,
  },
  {
    rule: 'aws-access-key',
    severity: 'block',
    message: 'Looks like an AWS access key id',
    test: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    rule: 'slack-token',
    severity: 'block',
    message: 'Looks like a Slack token',
    test: /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  },
  {
    rule: 'hardcoded-secret',
    severity: 'block',
    message: 'Possible hardcoded secret assigned to a string literal',
    test: /(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*['"][^'"]{8,}['"]/i,
  },
  {
    rule: 'focused-test',
    severity: 'block',
    message: 'Focused test will skip the rest of the suite',
    test: /(?:\b(?:describe|it|test)\.only\s*\()|(?:\bfdescribe\s*\()|(?:\bfit\s*\()/,
  },
  {
    rule: 'debugger-statement',
    severity: 'warn',
    message: 'Leftover debugger statement',
    test: /(?:^|\s|;)debugger\s*;?\s*$/,
  },
  {
    rule: 'console-log',
    severity: 'warn',
    message: 'Leftover console.log/debug',
    test: /\bconsole\.(?:log|debug)\s*\(/,
  },
  {
    rule: 'todo-added',
    severity: 'info',
    message: 'TODO/FIXME added',
    test: /\b(?:TODO|FIXME|XXX)\b/,
  },
]

const MAX_FINDINGS_PER_RULE = 20

/**
 * Parse a unified diff and flag issues in newly added lines.
 */
export function reviewDiff(diff: string): ReviewFinding[] {
  const findings: ReviewFinding[] = []
  const perRuleCount = new Map<string, number>()

  let currentFile: string | undefined
  // Track new-file line numbers from @@ hunk headers.
  let newLineNo = 0

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      // +++ b/path/to/file
      const path = raw.slice(4).replace(/^b\//, '').trim()
      currentFile = path === '/dev/null' ? undefined : path
      continue
    }
    if (raw.startsWith('--- ')) {
      continue
    }
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk) {
      newLineNo = Number(hunk[1])
      continue
    }
    if (raw.startsWith('+')) {
      const content = raw.slice(1)
      for (const rule of RULES) {
        if (!rule.test.test(content)) continue
        const count = perRuleCount.get(rule.rule) ?? 0
        if (count >= MAX_FINDINGS_PER_RULE) continue
        perRuleCount.set(rule.rule, count + 1)
        findings.push({
          severity: rule.severity,
          rule: rule.rule,
          message: rule.message,
          file: currentFile,
          line: newLineNo,
        })
      }
      newLineNo++
      continue
    }
    if (raw.startsWith('-')) {
      // removed line: does not advance the new-file counter
      continue
    }
    // context line
    newLineNo++
  }

  return findings
}

export function hasBlockingFindings(findings: ReviewFinding[]): boolean {
  return findings.some(f => f.severity === 'block')
}

const SEVERITY_ORDER: ReviewSeverity[] = ['block', 'warn', 'info']
const SEVERITY_LABEL: Record<ReviewSeverity, string> = {
  block: 'BLOCKING',
  warn: 'warning',
  info: 'info',
}

/**
 * Human-readable summary grouped by severity.
 */
export function summarizeFindings(findings: ReviewFinding[]): string {
  if (findings.length === 0) {
    return 'Self-review: no issues found.'
  }
  const lines: string[] = []
  for (const severity of SEVERITY_ORDER) {
    const group = findings.filter(f => f.severity === severity)
    if (group.length === 0) continue
    lines.push(`${SEVERITY_LABEL[severity]} (${group.length}):`)
    for (const f of group) {
      const loc = f.file ? ` ${f.file}${f.line ? `:${f.line}` : ''}` : ''
      lines.push(`  - [${f.rule}]${loc} ${f.message}`)
    }
  }
  return lines.join('\n')
}
