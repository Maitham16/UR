import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { safeParseJSON } from '../../utils/json.js'
import { parseHeadlessOutput } from './cliStepRunner.js'
import type { Verdict } from './executor.js'

/**
 * Public agent eval harness.
 *
 * A replayable, source-controlled way to pin down agent behavior — the
 * terminal-native analogue of SWE-bench / Terminal-Bench suites. A suite is a
 * list of cases (prompt + machine-checkable expectations) grouped by category
 * (coding, research, browser, mcp, memory, …). Grading is pure and
 * deterministic; the model call is behind an injected runner, so the scoring
 * logic is fully testable offline and CI can run the same suite that ships in
 * the repo. Use it as a regression net and as a published capability number.
 */

export type EvalExpectation = {
  /** Every substring must appear in the output (case-insensitive). */
  contains?: string[]
  /** None of these substrings may appear (case-insensitive). */
  notContains?: string[]
  /** Every pattern must match the output (case-insensitive). */
  regex?: string[]
  /** Expected VERDICT: line, when the case asks the agent to decide. */
  verdict?: Verdict
  /** Output must be at most this many characters. */
  maxOutputChars?: number
  /** Trajectory: every named tool must appear in the agent's tool-call trace. */
  toolsUsed?: string[]
  /** Trajectory: these tools must appear in this relative order (subsequence). */
  toolOrder?: string[]
  /** Trajectory: at most this many tool calls (penalizes wandering). */
  maxSteps?: number
  /** LLM-as-judge rubric; graded by an injected judge runner (reference-free). */
  judge?: string
}

export type EvalCase = {
  id: string
  category: string
  prompt: string
  expect: EvalExpectation
}

export type EvalSuite = {
  version: 1
  name: string
  description?: string
  cases: EvalCase[]
}

export type BenchmarkAdapterId = 'swe-bench' | 'terminal-bench' | 'aider-polyglot'

export type BenchmarkAdapterInfo = {
  id: BenchmarkAdapterId
  name: string
  description: string
  expectedFields: string[]
}

export const BENCHMARK_ADAPTERS: BenchmarkAdapterInfo[] = [
  {
    id: 'swe-bench',
    name: 'SWE-bench',
    description:
      'Converts software-engineering issue records into patch-oriented UR eval cases.',
    expectedFields: ['instance_id', 'repo', 'problem_statement', 'FAIL_TO_PASS'],
  },
  {
    id: 'terminal-bench',
    name: 'Terminal-Bench',
    description:
      'Converts terminal task records into shell-workflow UR eval cases.',
    expectedFields: ['id', 'instruction', 'setup', 'verification'],
  },
  {
    id: 'aider-polyglot',
    name: 'Aider Polyglot',
    description:
      'Converts multi-language coding task records into edit-and-test UR eval cases.',
    expectedFields: ['id', 'language', 'prompt', 'tests'],
  },
]

export type CheckResult = { name: string; passed: boolean; detail?: string }

export type EvalCaseResult = {
  id: string
  category: string
  passed: boolean
  isError: boolean
  durationMs: number
  checks: CheckResult[]
  outputPreview: string
}

export type EvalReport = {
  name: string
  generatedAt: string
  total: number
  passed: number
  failed: number
  passRate: number
  byCategory: Record<string, { passed: number; total: number }>
  cases: EvalCaseResult[]
}

/** Run one case and return its raw output. Injected so grading stays offline. */
export type EvalRunner = (
  evalCase: EvalCase,
) => Promise<{ output: string; isError?: boolean; trajectory?: string[] }>

/**
 * LLM-as-judge: scores an output against a rubric and returns PASS/FAIL. Injected
 * so suites can be graded offline with a stub; the production judge is a headless
 * `ur -p` call. Reference-free (no gold path needed), mirroring LangSmith judges.
 */
export type JudgeRunner = (input: {
  evalCase: EvalCase
  rubric: string
  output: string
}) => Promise<{ pass: boolean; detail?: string }>

export type EvalValidation = {
  valid: boolean
  errors: string[]
  warnings: string[]
}

const ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/i
const VERDICT_RE = /\bVERDICT:\s*(PASS|FAIL|PARTIAL)\b/i

function hasAnyExpectation(expect: EvalExpectation): boolean {
  return Boolean(
    expect.contains?.length ||
      expect.notContains?.length ||
      expect.regex?.length ||
      expect.verdict ||
      typeof expect.maxOutputChars === 'number',
  )
}

export function validateEvalSuite(suite: EvalSuite): EvalValidation {
  const errors: string[] = []
  const warnings: string[] = []
  if (!suite.name || !suite.name.trim()) errors.push('suite has no name')
  if (!Array.isArray(suite.cases) || suite.cases.length === 0) {
    errors.push('suite has no cases')
  }
  const seen = new Set<string>()
  for (const evalCase of suite.cases ?? []) {
    if (!ID_RE.test(evalCase.id ?? '')) {
      errors.push(`invalid case id "${evalCase.id}"`)
    }
    if (seen.has(evalCase.id)) errors.push(`duplicate case id "${evalCase.id}"`)
    seen.add(evalCase.id)
    if (!evalCase.prompt?.trim()) {
      errors.push(`case "${evalCase.id}" has an empty prompt`)
    }
    if (!evalCase.category?.trim()) {
      warnings.push(`case "${evalCase.id}" has no category`)
    }
    const expect = evalCase.expect ?? {}
    if (!hasAnyExpectation(expect)) {
      warnings.push(`case "${evalCase.id}" has no expectations (it will always pass)`)
    }
    for (const pattern of expect.regex ?? []) {
      try {
        new RegExp(pattern)
      } catch {
        errors.push(`case "${evalCase.id}" has an invalid regex: ${pattern}`)
      }
    }
  }
  return { valid: errors.length === 0, errors, warnings }
}

/** Pure, deterministic grading of one output against a case's expectations. */
export function gradeOutput(
  output: string,
  expect: EvalExpectation,
): CheckResult[] {
  const checks: CheckResult[] = []
  const haystack = output.toLowerCase()
  for (const needle of expect.contains ?? []) {
    checks.push({
      name: `contains "${needle}"`,
      passed: haystack.includes(needle.toLowerCase()),
    })
  }
  for (const needle of expect.notContains ?? []) {
    const present = haystack.includes(needle.toLowerCase())
    checks.push({
      name: `excludes "${needle}"`,
      passed: !present,
      detail: present ? 'found forbidden text' : undefined,
    })
  }
  for (const pattern of expect.regex ?? []) {
    let matched = false
    try {
      matched = new RegExp(pattern, 'i').test(output)
    } catch {
      matched = false
    }
    checks.push({ name: `matches /${pattern}/`, passed: matched })
  }
  if (expect.verdict) {
    const match = VERDICT_RE.exec(output)
    const got = match ? (match[1].toUpperCase() as Verdict) : null
    checks.push({
      name: `verdict ${expect.verdict}`,
      passed: got === expect.verdict,
      detail: got ? `got ${got}` : 'no verdict found',
    })
  }
  if (typeof expect.maxOutputChars === 'number') {
    checks.push({
      name: `≤ ${expect.maxOutputChars} chars`,
      passed: output.length <= expect.maxOutputChars,
      detail: `${output.length} chars`,
    })
  }
  return checks
}

/** Is `needle` an in-order subsequence of `haystack`? */
function isSubsequence(needle: string[], haystack: string[]): boolean {
  let i = 0
  for (const item of haystack) {
    if (i < needle.length && item === needle[i]) i += 1
  }
  return i === needle.length
}

/** Pure, deterministic grading of a tool-call trajectory against expectations. */
export function gradeTrajectory(
  trajectory: string[] | undefined,
  expect: EvalExpectation,
): CheckResult[] {
  const checks: CheckResult[] = []
  const wantsTrajectory =
    expect.toolsUsed?.length || expect.toolOrder?.length || typeof expect.maxSteps === 'number'
  if (!wantsTrajectory) return checks
  if (!trajectory) {
    checks.push({
      name: 'trajectory available',
      passed: false,
      detail: 'runner did not capture a tool-call trajectory',
    })
    return checks
  }
  for (const tool of expect.toolsUsed ?? []) {
    checks.push({ name: `uses ${tool}`, passed: trajectory.includes(tool) })
  }
  if (expect.toolOrder?.length) {
    checks.push({
      name: `tool order ${expect.toolOrder.join(' → ')}`,
      passed: isSubsequence(expect.toolOrder, trajectory),
    })
  }
  if (typeof expect.maxSteps === 'number') {
    checks.push({
      name: `≤ ${expect.maxSteps} steps`,
      passed: trajectory.length <= expect.maxSteps,
      detail: `${trajectory.length} tool calls`,
    })
  }
  return checks
}

function preview(text: string, max = 160): string {
  const value = text.replace(/\s+/g, ' ').trim()
  return value.length <= max ? value : `${value.slice(0, max)}…`
}

function buildReport(name: string, cases: EvalCaseResult[]): EvalReport {
  const passed = cases.filter(item => item.passed).length
  const byCategory: Record<string, { passed: number; total: number }> = {}
  for (const item of cases) {
    const bucket = (byCategory[item.category] ??= { passed: 0, total: 0 })
    bucket.total += 1
    if (item.passed) bucket.passed += 1
  }
  return {
    name,
    generatedAt: new Date().toISOString(),
    total: cases.length,
    passed,
    failed: cases.length - passed,
    passRate: cases.length > 0 ? Number((passed / cases.length).toFixed(2)) : 0,
    byCategory,
    cases,
  }
}

export type RunSuiteOptions = {
  /** Only run cases in this category. */
  category?: string
  /** LLM-as-judge for cases that declare an `expect.judge` rubric. */
  judge?: JudgeRunner
}

export async function runSuite(
  suite: EvalSuite,
  runner: EvalRunner,
  options: RunSuiteOptions = {},
): Promise<EvalReport> {
  const cases = options.category
    ? suite.cases.filter(item => item.category === options.category)
    : suite.cases
  const results: EvalCaseResult[] = []
  for (const evalCase of cases) {
    const started = Date.now()
    let output = ''
    let isError = false
    let trajectory: string[] | undefined
    try {
      const run = await runner(evalCase)
      output = run.output
      isError = run.isError === true
      trajectory = run.trajectory
    } catch (error) {
      output = error instanceof Error ? error.message : String(error)
      isError = true
    }
    const expect = evalCase.expect ?? {}
    const checks = [
      ...gradeOutput(output, expect),
      ...gradeTrajectory(trajectory, expect),
    ]
    if (expect.judge && options.judge) {
      const verdict = await options.judge({ evalCase, rubric: expect.judge, output })
      checks.push({
        name: `judge: ${expect.judge.slice(0, 48)}`,
        passed: verdict.pass,
        detail: verdict.detail,
      })
    } else if (expect.judge && !options.judge) {
      checks.push({
        name: 'judge available',
        passed: false,
        detail: 'case needs a judge but none was provided (run without --dry-run)',
      })
    }
    const passed = !isError && checks.every(check => check.passed)
    results.push({
      id: evalCase.id,
      category: evalCase.category,
      passed,
      isError,
      durationMs: Date.now() - started,
      checks,
      outputPreview: preview(output),
    })
  }
  return buildReport(suite.name, results)
}

export type ReliabilityCaseResult = {
  id: string
  category: string
  trials: number
  passes: number
  /** Fraction of trials that passed (pass@1 estimate). */
  passRate: number
  /** 1 if every trial passed, else 0 — the pass^k indicator for this case. */
  solvedAll: boolean
}

export type ReliabilityReport = {
  name: string
  generatedAt: string
  trials: number
  total: number
  /** Fraction of cases solved in ALL trials — τ-bench style pass^k. */
  passHatK: number
  /** Mean per-case pass rate across trials. */
  meanPassRate: number
  cases: ReliabilityCaseResult[]
}

/**
 * Multi-trial reliability: run each case `trials` times and report pass^k (the
 * fraction of cases solved in every trial) plus the mean per-case pass rate.
 * Flaky agents that pass on average but not every time are exposed here.
 */
export async function runSuiteReliability(
  suite: EvalSuite,
  runner: EvalRunner,
  options: RunSuiteOptions & { trials: number },
): Promise<ReliabilityReport> {
  const trials = Math.max(1, Math.floor(options.trials))
  const cases = options.category
    ? suite.cases.filter(item => item.category === options.category)
    : suite.cases
  const perCase = new Map<string, ReliabilityCaseResult>()
  for (const evalCase of cases) {
    perCase.set(evalCase.id, {
      id: evalCase.id,
      category: evalCase.category,
      trials,
      passes: 0,
      passRate: 0,
      solvedAll: true,
    })
  }
  for (let trial = 0; trial < trials; trial++) {
    const report = await runSuite(suite, runner, options)
    for (const result of report.cases) {
      const bucket = perCase.get(result.id)
      if (!bucket) continue
      if (result.passed) bucket.passes += 1
      else bucket.solvedAll = false
    }
  }
  const caseResults = [...perCase.values()].map(bucket => ({
    ...bucket,
    passRate: Number((bucket.passes / trials).toFixed(2)),
  }))
  const solvedAll = caseResults.filter(c => c.solvedAll).length
  const meanPassRate =
    caseResults.length > 0
      ? caseResults.reduce((sum, c) => sum + c.passRate, 0) / caseResults.length
      : 0
  return {
    name: suite.name,
    generatedAt: new Date().toISOString(),
    trials,
    total: caseResults.length,
    passHatK: caseResults.length > 0 ? Number((solvedAll / caseResults.length).toFixed(2)) : 0,
    meanPassRate: Number(meanPassRate.toFixed(2)),
    cases: caseResults,
  }
}

export type CliEvalRunnerOptions = {
  cwd: string
  maxTurns?: number
  skipPermissions?: boolean
  timeoutMs?: number
}

/** Production runner: each case spawns a headless `ur -p` and is graded. */
export function makeCliEvalRunner(options: CliEvalRunnerOptions): EvalRunner {
  return async (evalCase: EvalCase) => {
    const file = process.execPath
    const baseArgs = [process.argv[1] ?? '']
    const args = [...baseArgs, '-p', '--output-format', 'json']
    if (options.maxTurns && options.maxTurns > 0) {
      args.push('--max-turns', String(options.maxTurns))
    }
    if (options.skipPermissions) {
      args.push('--dangerously-skip-permissions')
    }
    args.push(evalCase.prompt)
    const result = await execFileNoThrowWithCwd(file, args, {
      cwd: options.cwd,
      timeout: options.timeoutMs ?? 30 * 60 * 1000,
      preserveOutputOnError: true,
    })
    const output =
      parseHeadlessOutput(result.stdout) || result.stderr || result.error || ''
    return { output, isError: result.code !== 0 }
  }
}

/** Offline runner: echoes the prompt so a suite can be exercised without a model. */
export function makeDryEvalRunner(): EvalRunner {
  return async (evalCase: EvalCase) => ({
    output: `[dry-run] would run: ${evalCase.prompt}`,
    isError: false,
  })
}

/** Production judge: a headless `ur -p` scores the output against the rubric. */
export function makeCliJudgeRunner(options: CliEvalRunnerOptions): JudgeRunner {
  return async ({ evalCase, rubric, output }) => {
    const file = process.execPath
    const baseArgs = [process.argv[1] ?? '']
    const prompt =
      `You are grading an AI agent's answer against a rubric. Be strict.\n\n` +
      `Task: ${evalCase.prompt}\n\nRubric: ${rubric}\n\nAnswer:\n${output.slice(0, 4000)}\n\n` +
      `Reply with exactly one line: "VERDICT: PASS" or "VERDICT: FAIL", then a brief reason.`
    const args = [...baseArgs, '-p', '--output-format', 'json', prompt]
    const result = await execFileNoThrowWithCwd(file, args, {
      cwd: options.cwd,
      timeout: options.timeoutMs ?? 10 * 60 * 1000,
      preserveOutputOnError: true,
    })
    const text = parseHeadlessOutput(result.stdout) || result.stderr || ''
    const match = /\bVERDICT:\s*(PASS|FAIL|PARTIAL)\b/i.exec(text)
    const got = match ? match[1].toUpperCase() : null
    return { pass: got === 'PASS', detail: preview(text, 120) }
  }
}

/** Offline judge: deterministic stub for exercising judge-bearing suites in tests/dry runs. */
export function makeDryJudgeRunner(pass = true): JudgeRunner {
  return async () => ({ pass, detail: '[dry-run] judge not invoked' })
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Pure HTML builder for the local eval dashboard. No network, no inline data leaks. */
export function buildDashboardHtml(
  reports: EvalReport[],
  reliability: ReliabilityReport[] = [],
): string {
  const generatedAt = new Date().toISOString()
  const card = (report: EvalReport): string => {
    const pct = Math.round(report.passRate * 100)
    const cats = Object.entries(report.byCategory)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(
        ([cat, b]) =>
          `<tr><td>${escapeHtml(cat)}</td><td>${b.passed}/${b.total}</td></tr>`,
      )
      .join('')
    const rows = report.cases
      .map(
        c =>
          `<tr class="${c.passed ? 'ok' : 'bad'}"><td>${c.passed ? '✓' : '✗'}</td>` +
          `<td>${escapeHtml(c.id)}</td><td>${escapeHtml(c.category)}</td>` +
          `<td>${c.durationMs}ms</td><td>${escapeHtml(c.outputPreview)}</td></tr>`,
      )
      .join('')
    return (
      `<section><h2>${escapeHtml(report.name)} — ${report.passed}/${report.total} (${pct}%)</h2>` +
      `<p class="muted">generated ${escapeHtml(report.generatedAt)}</p>` +
      `<table class="cats"><thead><tr><th>category</th><th>pass</th></tr></thead><tbody>${cats}</tbody></table>` +
      `<table class="cases"><thead><tr><th></th><th>case</th><th>category</th><th>time</th><th>output</th></tr></thead>` +
      `<tbody>${rows}</tbody></table></section>`
    )
  }
  const relCard = (rel: ReliabilityReport): string => {
    const rows = rel.cases
      .map(
        c =>
          `<tr class="${c.solvedAll ? 'ok' : 'bad'}"><td>${c.solvedAll ? '✓' : '✗'}</td>` +
          `<td>${escapeHtml(c.id)}</td><td>${c.passes}/${c.trials}</td><td>${Math.round(c.passRate * 100)}%</td></tr>`,
      )
      .join('')
    return (
      `<section><h2>Reliability: ${escapeHtml(rel.name)} — pass^${rel.trials} = ${Math.round(rel.passHatK * 100)}%</h2>` +
      `<p class="muted">mean pass rate ${Math.round(rel.meanPassRate * 100)}% over ${rel.trials} trials</p>` +
      `<table class="cases"><thead><tr><th></th><th>case</th><th>passes</th><th>rate</th></tr></thead>` +
      `<tbody>${rows}</tbody></table></section>`
    )
  }
  const body =
    reports.length === 0 && reliability.length === 0
      ? '<p class="muted">No eval reports yet. Run <code>ur eval run &lt;suite&gt;</code>.</p>'
      : reports.map(card).join('') + reliability.map(relCard).join('')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>UR Eval Dashboard</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; margin: 2rem; max-width: 1100px; }
  h1 { margin: 0 0 .25rem; } .muted { color: #888; font-size: 12px; }
  section { margin: 1.5rem 0; padding: 1rem; border: 1px solid #8884; border-radius: 8px; }
  table { border-collapse: collapse; width: 100%; margin-top: .5rem; }
  th, td { text-align: left; padding: .25rem .5rem; border-bottom: 1px solid #8882; vertical-align: top; }
  table.cats { width: auto; } td:last-child { color: #777; }
  tr.bad td:first-child { color: #c0392b; } tr.ok td:first-child { color: #27ae60; }
  code { background: #8881; padding: 0 .25rem; border-radius: 4px; }
</style></head>
<body><h1>UR Eval Dashboard</h1><p class="muted">generated ${escapeHtml(generatedAt)} · local-first, no network</p>
${body}</body></html>
`
}

export function loadAllReports(cwd: string): EvalReport[] {
  const dir = resultsDir(cwd)
  if (!existsSync(dir)) return []
  const reports: EvalReport[] = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json') || file.startsWith('reliability-')) continue
    const parsed = safeParseJSON(readFileSync(join(dir, file), 'utf-8'), false)
    if (parsed && typeof parsed === 'object') reports.push(parsed as EvalReport)
  }
  return reports.sort((a, b) => a.name.localeCompare(b.name))
}

export function loadAllReliability(cwd: string): ReliabilityReport[] {
  const dir = resultsDir(cwd)
  if (!existsSync(dir)) return []
  const reports: ReliabilityReport[] = []
  for (const file of readdirSync(dir)) {
    if (!file.startsWith('reliability-') || !file.endsWith('.json')) continue
    const parsed = safeParseJSON(readFileSync(join(dir, file), 'utf-8'), false)
    if (parsed && typeof parsed === 'object') reports.push(parsed as ReliabilityReport)
  }
  return reports.sort((a, b) => a.name.localeCompare(b.name))
}

export function saveReliabilityReport(cwd: string, report: ReliabilityReport): string {
  mkdirSync(resultsDir(cwd), { recursive: true })
  const path = join(resultsDir(cwd), `reliability-${suiteSlug(report.name)}.json`)
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`)
  return path
}

export function writeDashboard(cwd: string): string {
  const html = buildDashboardHtml(loadAllReports(cwd), loadAllReliability(cwd))
  mkdirSync(evalsDir(cwd), { recursive: true })
  const path = join(evalsDir(cwd), 'dashboard.html')
  writeFileSync(path, html)
  return path
}

export function formatReliabilityReport(report: ReliabilityReport, json: boolean): string {
  if (json) return JSON.stringify(report, null, 2)
  const lines = [
    `Reliability: ${report.name}`,
    `pass^${report.trials}: ${Math.round(report.passHatK * 100)}% (cases solved in every trial)`,
    `mean pass rate: ${Math.round(report.meanPassRate * 100)}%`,
    '',
  ]
  for (const c of report.cases) {
    const mark = c.solvedAll ? '✓' : '✗'
    lines.push(`${mark} ${c.id} (${c.category}) — ${c.passes}/${c.trials} (${Math.round(c.passRate * 100)}%)`)
  }
  return lines.join('\n')
}

export function evalsDir(cwd: string): string {
  return join(cwd, '.ur', 'evals')
}

function resultsDir(cwd: string): string {
  return join(evalsDir(cwd), '.results')
}

function suiteSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').slice(0, 64)
}

export function parseSuiteText(text: string): EvalSuite {
  const parsed = safeParseJSON(text, false)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Eval suite is not a JSON object')
  }
  const suite = parsed as Partial<EvalSuite>
  if (!suite.name || !Array.isArray(suite.cases)) {
    throw new Error('Eval suite must have a name and a cases array')
  }
  return {
    version: 1,
    name: String(suite.name),
    description: suite.description ? String(suite.description) : undefined,
    cases: suite.cases.map((raw, index) => {
      const item = (raw ?? {}) as Partial<EvalCase>
      return {
        id: String(item.id ?? `case-${index + 1}`),
        category: String(item.category ?? 'general'),
        prompt: String(item.prompt ?? ''),
        expect: (item.expect ?? {}) as EvalExpectation,
      }
    }),
  }
}

export function listSuites(cwd: string): string[] {
  const dir = evalsDir(cwd)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(file => file.endsWith('.json'))
    .map(file => file.replace(/\.json$/, ''))
    .sort()
}

export function loadSuite(cwd: string, name: string): EvalSuite | null {
  const path = join(evalsDir(cwd), `${suiteSlug(name)}.json`)
  if (!existsSync(path)) return null
  try {
    return parseSuiteText(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

export function saveSuite(
  cwd: string,
  suite: EvalSuite,
  options: { force?: boolean } = {},
): { path: string; created: boolean } {
  const path = join(evalsDir(cwd), `${suiteSlug(suite.name)}.json`)
  mkdirSync(evalsDir(cwd), { recursive: true })
  if (existsSync(path) && options.force !== true) {
    return { path, created: false }
  }
  writeFileSync(path, `${JSON.stringify(suite, null, 2)}\n`)
  return { path, created: true }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => String(item)).filter(Boolean)
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function recordId(record: Record<string, unknown>, fallback: string): string {
  const id =
    asString(record.instance_id) ??
    asString(record.task_id) ??
    asString(record.id) ??
    asString(record.name) ??
    fallback
  return id
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || fallback
}

function parseBenchmarkRecords(text: string): Record<string, unknown>[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  const parsed = safeParseJSON(trimmed, false)
  if (Array.isArray(parsed)) return parsed.filter(item => item && typeof item === 'object') as Record<string, unknown>[]
  if (parsed && typeof parsed === 'object') {
    const object = parsed as Record<string, unknown>
    if (Array.isArray(object.instances)) return object.instances.filter(item => item && typeof item === 'object') as Record<string, unknown>[]
    if (Array.isArray(object.tasks)) return object.tasks.filter(item => item && typeof item === 'object') as Record<string, unknown>[]
    if (Array.isArray(object.cases)) return object.cases.filter(item => item && typeof item === 'object') as Record<string, unknown>[]
    return [object]
  }
  const records: Record<string, unknown>[] = []
  for (const line of trimmed.split('\n')) {
    const item = safeParseJSON(line, false)
    if (item && typeof item === 'object') records.push(item as Record<string, unknown>)
  }
  return records
}

function sweBenchCase(record: Record<string, unknown>, index: number): EvalCase {
  const id = recordId(record, `swe-${index + 1}`)
  const repo = asString(record.repo) ?? asString(record.repository) ?? 'the target repository'
  const problem = asString(record.problem_statement) ?? asString(record.issue) ?? asString(record.prompt) ?? ''
  const failToPass = asStringArray(record.FAIL_TO_PASS ?? record.fail_to_pass)
  const passToPass = asStringArray(record.PASS_TO_PASS ?? record.pass_to_pass)
  const tests = [...failToPass, ...passToPass]
  return {
    id,
    category: 'swe-bench',
    prompt: [
      `You are UR running locally on a SWE-bench style task for ${repo}.`,
      asString(record.base_commit) ? `Base commit: ${asString(record.base_commit)}` : undefined,
      '',
      'Problem statement:',
      problem,
      '',
      tests.length
        ? `Relevant tests:\n${tests.map(test => `- ${test}`).join('\n')}`
        : 'No explicit test list was provided in this record.',
      '',
      'Fix the issue in the local checkout. Prefer a minimal patch and run the relevant tests before finalizing.',
    ]
      .filter(Boolean)
      .join('\n'),
    expect: {
      notContains: ['I cannot'],
      judge:
        'Pass if the answer describes a concrete code fix, relevant tests, and does not refuse the software-engineering task. For full benchmark scoring, apply the produced patch and run the benchmark harness tests.',
    },
  }
}

function terminalBenchCase(record: Record<string, unknown>, index: number): EvalCase {
  const id = recordId(record, `terminal-${index + 1}`)
  const instruction =
    asString(record.instruction) ??
    asString(record.prompt) ??
    asString(record.task) ??
    asString(record.description) ??
    ''
  const setup = asString(record.setup) ?? asString(record.setup_script)
  const verification =
    asString(record.verification) ??
    asString(record.test_command) ??
    asString(record.oracle) ??
    asString(record.expected)
  return {
    id,
    category: 'terminal-bench',
    prompt: [
      'You are UR running a Terminal-Bench style task in a local shell workspace.',
      setup ? `Setup context:\n${setup}` : undefined,
      '',
      'Task:',
      instruction,
      '',
      verification ? `Verification:\n${verification}` : 'State the commands you would run to verify the result.',
      '',
      'Use terminal-safe, local commands and finish with a short result summary.',
    ]
      .filter(Boolean)
      .join('\n'),
    expect: {
      notContains: ['I cannot'],
      judge:
        'Pass if the answer gives a plausible terminal workflow, performs or names verification, and stays within the local task constraints.',
    },
  }
}

function aiderPolyglotCase(record: Record<string, unknown>, index: number): EvalCase {
  const id = recordId(record, `aider-${index + 1}`)
  const language = asString(record.language) ?? asString(record.lang)
  const prompt =
    asString(record.prompt) ??
    asString(record.instruction) ??
    asString(record.problem_statement) ??
    ''
  const tests = asStringArray(record.tests ?? record.test_commands ?? record.test_command)
  return {
    id,
    category: 'aider-polyglot',
    prompt: [
      `You are UR running an Aider Polyglot style coding task${language ? ` in ${language}` : ''}.`,
      '',
      'Task:',
      prompt,
      '',
      tests.length
        ? `Expected verification:\n${tests.map(test => `- ${test}`).join('\n')}`
        : 'Identify and run the narrowest relevant verification for this language.',
      '',
      'Edit locally, keep the patch minimal, and summarize changed files and test results.',
    ]
      .filter(Boolean)
      .join('\n'),
    expect: {
      notContains: ['I cannot'],
      judge:
        'Pass if the answer targets the requested language task, identifies changed files or patch intent, and includes relevant verification.',
    },
  }
}

export function buildBenchmarkSuite(
  adapter: BenchmarkAdapterId,
  records: Record<string, unknown>[],
  options: { name?: string; limit?: number } = {},
): EvalSuite {
  const limited =
    options.limit && options.limit > 0 ? records.slice(0, Math.floor(options.limit)) : records
  const cases = limited.map((record, index) => {
    if (adapter === 'swe-bench') return sweBenchCase(record, index)
    if (adapter === 'terminal-bench') return terminalBenchCase(record, index)
    return aiderPolyglotCase(record, index)
  })
  const info = BENCHMARK_ADAPTERS.find(item => item.id === adapter)
  return {
    version: 1,
    name: options.name ?? adapter,
    description: `${info?.name ?? adapter} adapter suite generated from a local benchmark export. Runs through UR's local/Ollama eval harness; no provider API is required.`,
    cases,
  }
}

export function importBenchmarkSuite(
  cwd: string,
  adapter: BenchmarkAdapterId,
  file: string,
  options: { name?: string; limit?: number; force?: boolean } = {},
): { suite: EvalSuite; path: string; created: boolean; records: number } {
  const records = parseBenchmarkRecords(readFileSync(file, 'utf-8'))
  if (records.length === 0) {
    throw new Error(`No benchmark records found in ${file}`)
  }
  const suite = buildBenchmarkSuite(adapter, records, options)
  const saved = saveSuite(cwd, suite, { force: options.force })
  return { suite, path: saved.path, created: saved.created, records: records.length }
}

export function saveReport(cwd: string, report: EvalReport): string {
  mkdirSync(resultsDir(cwd), { recursive: true })
  const path = join(resultsDir(cwd), `${suiteSlug(report.name)}.json`)
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`)
  return path
}

export function loadReport(cwd: string, name: string): EvalReport | null {
  const path = join(resultsDir(cwd), `${suiteSlug(name)}.json`)
  if (!existsSync(path)) return null
  const parsed = safeParseJSON(readFileSync(path, 'utf-8'), false)
  return parsed && typeof parsed === 'object' ? (parsed as EvalReport) : null
}

export function defaultEvalSuite(): EvalSuite {
  return {
    version: 1,
    name: 'starter',
    description:
      'Starter UR eval suite covering coding, research, browser, MCP, memory, and verification. Edit the cases and expectations freely.',
    cases: [
      {
        id: 'coding-add',
        category: 'coding',
        prompt:
          'Write a TypeScript function named add that takes two numbers and returns their sum. Output only the code in a single code block.',
        expect: { contains: ['function add', 'return'], notContains: ['I cannot'] },
      },
      {
        id: 'research-mcp',
        category: 'research',
        prompt:
          'In one sentence, what does the acronym MCP stand for in the agent-tooling ecosystem? Include a source URL.',
        expect: { contains: ['Model Context Protocol'], regex: ['https?://'] },
      },
      {
        id: 'browser-smoke',
        category: 'browser',
        prompt:
          'List three deterministic assertions you would check to verify a web page rendered correctly. Output a numbered list and mention console errors.',
        expect: { contains: ['console'], regex: ['1\\.'] },
      },
      {
        id: 'mcp-permission',
        category: 'mcp',
        prompt:
          'In one sentence, explain how UR routes MCP tool calls through its permission system.',
        expect: { contains: ['permission'] },
      },
      {
        id: 'memory-curate',
        category: 'memory',
        prompt:
          'State the single most durable fact worth remembering about this project in one short sentence prefixed with "FACT:".',
        expect: { regex: ['FACT:'] },
      },
      {
        id: 'verify-gate',
        category: 'verification',
        prompt:
          'Decide whether 2 + 2 equals 4. End with exactly one line "VERDICT: PASS" if correct, otherwise "VERDICT: FAIL".',
        expect: { verdict: 'PASS' },
      },
    ],
  }
}

export type ScaffoldEvalsResult = {
  root: string
  created: string[]
  skipped: string[]
}

const EVALS_README = `# UR Eval Harness

Replayable agent evals — the terminal-native analogue of SWE-bench / Terminal-Bench.

Each suite is a JSON file with cases: a prompt plus machine-checkable
expectations (contains / notContains / regex / verdict / maxOutputChars),
grouped by category.

Commands:

- \`ur eval list\` — list suites
- \`ur eval validate <suite>\` — validate a suite file
- \`ur eval run <suite>\` — run every case through a headless \`ur -p\` and grade it
- \`ur eval run <suite> --dry-run\` — exercise the suite offline (no model calls)
- \`ur eval run <suite> --category coding\` — run only one category
- \`ur eval report <suite>\` — re-print the last run's report
- \`ur eval bench list\` — show supported benchmark adapters
- \`ur eval bench swe-bench --file local.jsonl --name local-swe\` — import a local benchmark export as a UR suite

Reports are written to \`.ur/evals/.results/\` (keep them out of Git if you prefer).
`

export function scaffoldEvals(
  cwd: string,
  options: { force?: boolean } = {},
): ScaffoldEvalsResult {
  const root = evalsDir(cwd)
  const result: ScaffoldEvalsResult = { root, created: [], skipped: [] }
  mkdirSync(root, { recursive: true })

  const readmePath = join(root, 'README.md')
  if (existsSync(readmePath) && options.force !== true) {
    result.skipped.push('evals/README.md')
  } else {
    writeFileSync(readmePath, EVALS_README)
    result.created.push('evals/README.md')
  }

  const saved = saveSuite(cwd, defaultEvalSuite(), { force: options.force })
  if (saved.created) result.created.push('evals/starter.json')
  else result.skipped.push('evals/starter.json')

  return result
}

export function formatSuiteValidation(
  suite: EvalSuite,
  validation: EvalValidation,
): string {
  const lines = [
    `Eval suite: ${suite.name} (${suite.cases.length} cases)`,
    validation.valid ? 'Valid: yes' : 'Valid: no',
  ]
  if (validation.errors.length > 0) {
    lines.push('Errors:')
    for (const error of validation.errors) lines.push(`  - ${error}`)
  }
  if (validation.warnings.length > 0) {
    lines.push('Warnings:')
    for (const warning of validation.warnings) lines.push(`  - ${warning}`)
  }
  return lines.join('\n')
}

export function formatEvalReport(report: EvalReport, json: boolean): string {
  if (json) return JSON.stringify(report, null, 2)
  const pct = Math.round(report.passRate * 100)
  const lines = [
    `Eval report: ${report.name}`,
    `Pass rate: ${report.passed}/${report.total} (${pct}%)`,
    '',
  ]
  const categories = Object.entries(report.byCategory).sort((a, b) =>
    a[0].localeCompare(b[0]),
  )
  if (categories.length > 0) {
    lines.push('By category:')
    for (const [category, bucket] of categories) {
      lines.push(`  ${category.padEnd(14)} ${bucket.passed}/${bucket.total}`)
    }
    lines.push('')
  }
  for (const item of report.cases) {
    const mark = item.passed ? '✓' : '✗'
    lines.push(`${mark} ${item.id} (${item.category})`)
    for (const check of item.checks) {
      if (!check.passed) {
        const detail = check.detail ? ` — ${check.detail}` : ''
        lines.push(`    ✗ ${check.name}${detail}`)
      }
    }
    if (item.isError) lines.push('    ✗ runner reported an error')
  }
  return lines.join('\n')
}
