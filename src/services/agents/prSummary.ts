/**
 * PR-quality output formatter for agent/tool results.
 *
 * Produces a structured summary that looks like a professional pull request:
 * summary, changed files, tests run, risks, rollback command, and remaining TODOs.
 */

import { existsSync, readFileSync } from 'node:fs'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { findGitRoot, gitExe } from '../../utils/git.js'

export type PrSummary = {
  title: string
  description: string
  changedFiles: string[]
  testsRun: string[]
  detectedTestCommands: string[]
  risks: string[]
  rollbackCommand: string
  remainingTodos: string[]
  diffStat?: string
}

export type PrSummaryOptions = {
  cwd: string
  title: string
  description?: string
  base?: string
  rollbackCommand?: string
  testsRun?: string[]
  extraRisks?: string[]
  extraTodos?: string[]
}

async function git(cwd: string, args: string[]): Promise<{ stdout: string; code: number }> {
  return execFileNoThrowWithCwd(gitExe(), args, { cwd, timeout: 30_000, preserveOutputOnError: true })
}

async function changedFiles(cwd: string, base?: string): Promise<string[]> {
  if (!findGitRoot(cwd)) return []
  const baseRef = base ?? 'HEAD'
  const [committed, uncommitted, untracked] = await Promise.all([
    git(cwd, ['diff', '--name-only', `${baseRef}...HEAD`]).catch(() => ({ stdout: '', code: 1 })),
    git(cwd, ['diff', '--name-only', 'HEAD']).catch(() => ({ stdout: '', code: 1 })),
    git(cwd, ['ls-files', '--others', '--exclude-standard']).catch(() => ({ stdout: '', code: 1 })),
  ])
  const all = new Set<string>()
  for (const result of [committed, uncommitted, untracked]) {
    if (result.code !== 0) continue
    for (const line of result.stdout.split('\n')) {
      const file = line.trim()
      if (file) all.add(file)
    }
  }
  return [...all].sort()
}

async function diffStat(cwd: string, base?: string): Promise<string | undefined> {
  if (!findGitRoot(cwd)) return undefined
  const baseRef = base ?? 'HEAD'
  const result = await git(cwd, ['diff', '--stat', `${baseRef}...HEAD`]).catch(() => ({ stdout: '', code: 1 }))
  if (result.code !== 0 || !result.stdout.trim()) return undefined
  return result.stdout.trim()
}

function detectTests(cwd: string): string[] {
  const tests: string[] = []
  const pkgPath = `${cwd}/package.json`
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { scripts?: Record<string, string> }
      for (const name of Object.keys(pkg.scripts ?? {})) {
        if (/^(test|t|check|lint|typecheck|ci)$/.test(name) || /^(test|check|lint):/.test(name)) {
          tests.push(`bun run ${name}`)
        }
      }
    } catch {
      // ignore
    }
  }
  if (existsSync(`${cwd}/Cargo.toml`)) tests.push('cargo test')
  if (existsSync(`${cwd}/go.mod`)) tests.push('go test ./...')
  if (existsSync(`${cwd}/pyproject.toml`) || existsSync(`${cwd}/requirements.txt`)) {
    tests.push('pytest')
  }
  return tests
}

function defaultRisks(cwd: string, changedFiles: string[]): string[] {
  const risks: string[] = []
  const sensitive = new Set(['package.json', 'bun.lock', 'Cargo.lock', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock'])
  for (const file of changedFiles) {
    if (sensitive.has(file)) {
      risks.push(`Dependency/lockfile changed: ${file}`)
    }
    if (/\.(test|spec)\.(ts|tsx|js|jsx|py|rs|go)$/.test(file)) {
      risks.push(`Test file modified: ${file}`)
    }
  }
  if (!findGitRoot(cwd)) {
    risks.push('Not inside a git repository — no automatic rollback via git.')
  }
  return risks
}

export async function buildPrSummary(options: PrSummaryOptions): Promise<PrSummary> {
  const { cwd, title, description = '', base, rollbackCommand, testsRun = [], extraRisks = [], extraTodos = [] } = options
  const files = await changedFiles(cwd, base)
  const stat = await diffStat(cwd, base)
  const detected = detectTests(cwd)
  const risks = [...defaultRisks(cwd, files), ...extraRisks]
  const todos: string[] = []
  if (testsRun.length === 0) {
    todos.push(
      detected.length
        ? `Run and record verification: ${detected.join(', ')}.`
        : 'No test command detected — verify manually.',
    )
  }
  todos.push(...extraTodos)
  return {
    title,
    description,
    changedFiles: files,
    testsRun,
    detectedTestCommands: detected,
    risks,
    rollbackCommand: rollbackCommand ?? (findGitRoot(cwd) ? 'git reset --hard HEAD' : 'manual file restore'),
    remainingTodos: todos,
    diffStat: stat,
  }
}

export function formatPrSummary(summary: PrSummary, json = false): string {
  if (json) return JSON.stringify(summary, null, 2)
  const lines = [
    `# ${summary.title}`,
    '',
    '## Summary',
    summary.description || 'No summary provided.',
    '',
    '## Changed files',
    ...(summary.changedFiles.length
      ? summary.changedFiles.map(f => `- ${f}`)
      : ['- no tracked changes detected']),
    '',
    '## Tests run',
    ...(summary.testsRun.length
      ? summary.testsRun.map(t => `- ${t}`)
      : ['- none recorded by UR for this PR handoff']),
    '',
    '## Detected verification commands',
    ...(summary.detectedTestCommands.length
      ? summary.detectedTestCommands.map(t => `- ${t}`)
      : ['- no test commands detected']),
    '',
    '## Risks',
    ...(summary.risks.length
      ? summary.risks.map(r => `- ${r}`)
      : ['- no obvious risks flagged']),
    '',
    '## Rollback command',
    '```bash',
    summary.rollbackCommand,
    '```',
    '',
    '## Remaining TODOs',
    ...(summary.remainingTodos.length
      ? summary.remainingTodos.map(t => `- [ ] ${t}`)
      : ['- none']),
  ]
  if (summary.diffStat) {
    lines.push('', '## Diff stat', '```', summary.diffStat, '```')
  }
  return lines.join('\n')
}
