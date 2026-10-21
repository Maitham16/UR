#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

function sourceIdentity() {
  try {
    const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 })
    const paths = [...new Set(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'src', 'scripts', 'package.json', 'bun.lock', 'tsconfig.json']).split('\0').filter(Boolean))].sort()
    const hash = createHash('sha256')
    let files = 0
    for (const path of paths) {
      if (!existsSync(join(root, path))) { hash.update(JSON.stringify([path, 'deleted'])); continue }
      if (!lstatSync(join(root, path)).isFile()) throw new Error('Unsupported source file kind')
      hash.update(JSON.stringify(path)).update(createHash('sha256').update(readFileSync(join(root, path))).digest()); files++
    }
    return { dirty: git(['status', '--porcelain']).trim().length > 0, sha256: hash.digest('hex'), files, scope: 'src,scripts,package.json,bun.lock,tsconfig.json at report generation' }
  } catch { return null }
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
    ...(item.metrics?.evaluationMode ? {
      evidence: {
        evaluationMode: item.metrics.evaluationMode,
        executableSha256: item.metrics.executableSha256 ?? null,
        patchSha256: item.metrics.patchSha256 ?? null,
        verificationSha256: item.metrics.verificationSha256 ?? null,
        completionClaim: item.metrics.completionClaim ?? 'unspecified',
        falseCompletion: item.metrics.falseCompletion ?? null,
        exitCode: item.metrics.exitCode ?? null,
        testPassed: item.metrics.testPassed ?? null,
        configuration: item.metrics.configuration ?? null,
        provenance: item.metrics.provenance ?? null,
        toolCalls: item.trajectory?.toolCalls ?? null,
        failedToolCalls: item.trajectory?.failedToolCalls ?? null,
        turns: item.trajectory?.turns ?? null,
        humanInterventions: item.metrics.humanInterventions ?? null,
        rollbacks: item.metrics.rollbacks ?? null,
        costUSD: item.metrics.costUSD ?? null,
        inputTokens: item.metrics.inputTokens ?? null,
        outputTokens: item.metrics.outputTokens ?? null,
      },
    } : {}),
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
      typeof input === 'number' && typeof output === 'number'
        ? input + output
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
      name: 'ur-nexus',
      version,
      commit: options.commit ?? gitCommit(),
      source: options.sourceIdentity ?? sourceIdentity(),
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
      completionClaims: report.completionClaims ?? null,
      falseCompletions: report.falseCompletions ?? null,
      falseCompletionRate: report.falseCompletionRate ?? null,
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
