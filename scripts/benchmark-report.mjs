#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

export const benchmarkCategories = [
  'internal-regression',
  'terminal-coding',
  'provider-routing',
  'tool-use',
  'sandbox-safety',
  'swe-bench-lite',
  'terminal-bench',
  'aider-polyglot',
  'custom',
]

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      options[key] = true
    } else {
      options[key] = next
      i++
    }
  }
  return options
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function packageVersion() {
  return readJson(join(root, 'package.json')).version
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

function bunVersion() {
  try {
    return execFileSync('bun', ['--version'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

function firstModel(report) {
  for (const item of report.cases ?? []) {
    const model = item?.metrics?.model
    if (typeof model === 'string' && model.trim()) return model.trim()
  }
  return process.env.UR_MODEL ?? process.env.OLLAMA_MODEL ?? process.env.MODEL ?? 'unspecified'
}

function failedCheckNames(caseResult) {
  return (caseResult.checks ?? [])
    .filter(check => check && check.passed === false)
    .map(check => String(check.name ?? 'unnamed check'))
}

function failureCategory(caseResult) {
  if (caseResult.isError) return 'runtime-error'
  const checks = failedCheckNames(caseResult).join(' ').toLowerCase()
  if (checks.includes('test command')) return 'verification-failure'
  if (checks.includes('trajectory') || checks.includes('uses ') || checks.includes('tool order')) {
    return 'tool-use-failure'
  }
  if (checks.includes('judge')) return 'judge-failure'
  if (checks.includes('contains') || checks.includes('matches') || checks.includes('verdict')) {
    return 'output-mismatch'
  }
  return 'unknown'
}

function summarizeFailures(report) {
  const failedTasks = []
  const failureCategories = {}
  for (const item of report.cases ?? []) {
    if (item.passed) continue
    const category = failureCategory(item)
    failureCategories[category] = (failureCategories[category] ?? 0) + 1
    failedTasks.push({
      id: item.id,
      category: item.category,
      failureCategory: category,
      failedChecks: failedCheckNames(item),
    })
  }
  return { failedTasks, failureCategories }
}

function taskResults(report) {
  return (report.cases ?? []).map(item => ({
    id: String(item.id ?? item.name ?? 'unnamed-task'),
    name: String(item.name ?? item.id ?? 'unnamed task'),
    category: String(item.category ?? 'uncategorized'),
    passed: item.passed === true,
    wallTimeMs:
      typeof item.durationMs === 'number'
        ? Math.max(0, Math.round(item.durationMs))
        : null,
    failureCategory: item.passed === true ? null : failureCategory(item),
  }))
}

function tokenUsage(report) {
  const input = report.totalInputTokens
  const output = report.totalOutputTokens
  if (typeof input !== 'number' && typeof output !== 'number') return null
  return {
    inputTokens: input ?? null,
    outputTokens: output ?? null,
    totalTokens:
      typeof input === 'number' || typeof output === 'number'
        ? (input ?? 0) + (output ?? 0)
        : null,
  }
}

function safeFilePart(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'benchmark'
}

export function buildBenchmarkReport(report, options = {}) {
  const version = options.version ?? packageVersion()
  const benchmarkName = options.benchmarkName ?? report.name ?? 'unnamed-benchmark'
  const category = options.category ?? 'internal-regression'
  if (!benchmarkCategories.includes(category)) {
    throw new Error(
      `Unknown benchmark category "${category}". Expected one of: ${benchmarkCategories.join(', ')}`,
    )
  }

  const { failedTasks, failureCategories } = summarizeFailures(report)
  return {
    schemaVersion: 1,
    template: false,
    agent: {
      name: 'ur-agent',
      version,
      commit: options.commit ?? gitCommit(),
    },
    date: options.date ?? new Date().toISOString(),
    benchmark: {
      name: benchmarkName,
      category,
      taskCount: report.total ?? (report.cases ?? []).length,
    },
    runtime: {
      provider: options.provider ?? process.env.UR_PROVIDER ?? 'unspecified',
      model: options.model ?? firstModel(report),
      environment: {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        bun: options.bunVersion ?? bunVersion(),
        cwd: options.cwd ?? process.cwd(),
      },
    },
    results: {
      passed: report.passed ?? 0,
      failed: report.failed ?? failedTasks.length,
      passRate: report.passRate ?? 0,
      taskResults: taskResults(report),
      failedTasks,
      failureCategories,
      wallTimeMs: report.totalDurationMs ?? 0,
      tokenUsage: tokenUsage(report),
      costUSD: typeof report.totalCostUSD === 'number' ? report.totalCostUSD : null,
    },
    reproduction: {
      command:
        options.command ??
        `ur eval run ${report.name ?? '<suite>'} --metrics --json`,
      inputReport: options.inputReport ?? null,
      generatedBy: 'scripts/benchmark-report.mjs',
    },
  }
}

function usage() {
  return [
    'Usage:',
    '  bun run benchmark:report -- --input .ur/evals/.results/<suite>.json --category internal-regression --provider <provider> --model <model> --command "ur eval run <suite> --metrics --json"',
    '',
    `Categories: ${benchmarkCategories.join(', ')}`,
  ].join('\n')
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help || options.h) {
    console.log(usage())
    return
  }

  if (!options.input || typeof options.input !== 'string') {
    console.error(usage())
    process.exit(1)
  }

  const input = options.input
  if (!existsSync(input)) {
    console.error(`Benchmark input report not found: ${input}`)
    process.exit(1)
  }

  const evalReport = readJson(input)
  const version = options.version ?? packageVersion()
  const benchmarkName = options.benchmark ?? evalReport.name ?? basename(input, '.json')
  const report = buildBenchmarkReport(evalReport, {
    benchmarkName,
    category: options.category ?? 'internal-regression',
    provider: options.provider,
    model: options.model,
    command: options.command,
    version,
    inputReport: relative(root, input),
  })

  const output =
    typeof options.output === 'string'
      ? options.output
      : join(
          root,
          'benchmarks',
          'results',
          version,
          `${safeFilePart(benchmarkName)}-${report.date.replace(/[:.]/g, '-')}.json`,
        )
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Wrote benchmark report: ${output}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
