import {
  BENCHMARK_ADAPTERS,
  type BenchmarkAdapterId,
  type EvalReport,
  buildLeaderboard,
  evalsDir,
  formatEvalReport,
  formatReliabilityReport,
  formatSuiteValidation,
  importBenchmarkSuite,
  listSuites,
  loadAllReports,
  loadReport,
  loadSuite,
  makeCliEvalRunner,
  makeCliJudgeRunner,
  makeDryEvalRunner,
  makeDryJudgeRunner,
  runSuite,
  runSuiteCompare,
  runSuiteReliability,
  saveReliabilityReport,
  saveReport,
  scaffoldEvals,
  suiteSlug,
  validateEvalSuite,
  writeDashboard,
  type CompareLabel,
  formatCompareReport,
} from '../../services/agents/evals.js'
import {
  getBuiltinSuite,
  installBuiltinSuite,
  listBuiltinSuiteIds,
  type BuiltinSuiteId,
} from '../../services/agents/benchmarkSuites.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'
import { isNetworkRestricted } from '../../utils/offlineMode.js'
import { getSessionId } from '../../bootstrap/state.js'
import { loadRunManifests, readRunManifest, type RunManifest } from '../../services/agents/runArtifacts.js'

function optionValue(tokens: string[], flag: string): string | undefined {
  const index = tokens.indexOf(flag)
  return index >= 0 ? tokens[index + 1] : undefined
}

function notFound(name: string): { type: 'text'; value: string } {
  const available = listSuites(getCwd())
  const hint = available.length > 0 ? `\nAvailable: ${available.join(', ')}` : ''
  return {
    type: 'text',
    value: `Eval suite not found: ${name}${hint}\nCreate the starter suite: ur eval init`,
  }
}

function isBenchmarkAdapter(value: string | undefined): value is BenchmarkAdapterId {
  return BENCHMARK_ADAPTERS.some(adapter => adapter.id === value)
}

function formatBenchmarkAdapters(json: boolean): string {
  if (json) return JSON.stringify({ adapters: BENCHMARK_ADAPTERS }, null, 2)
  return [
    'Benchmark adapters',
    '',
    ...BENCHMARK_ADAPTERS.map(
      adapter =>
        `- ${adapter.id}: ${adapter.description}\n  fields: ${adapter.expectedFields.join(', ')}`,
    ),
  ].join('\n')
}

const EVAL_FLAGS_WITH_VALUES = new Set([
  '--file',
  '--name',
  '--limit',
  '--category',
  '--max-turns',
  '--model',
  '--repeat',
  '--strategy',
  '--format',
])

function stripFlagValues(tokens: string[]): string[] {
  const result: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (EVAL_FLAGS_WITH_VALUES.has(token)) {
      i++ // skip value
      continue
    }
    result.push(token)
  }
  return result
}

export const call: LocalCommandCall = async (args: string) => {
  const cwd = getCwd()
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const force = tokens.includes('--force')
  const positional = stripFlagValues(tokens).filter(token => !token.startsWith('--'))
  const command = positional[0] ?? 'list'
  const name = positional[1]

  if (command === 'init') {
    const result = scaffoldEvals(cwd, { force })
    const created =
      result.created.length > 0 ? `created: ${result.created.join(', ')}` : ''
    const kept =
      result.skipped.length > 0 ? `kept existing: ${result.skipped.join(', ')}` : ''
    return {
      type: 'text',
      value: [`Eval suites ready at ${result.root}`, created, kept]
        .filter(Boolean)
        .join('\n'),
    }
  }

  if (command === 'list') {
    const names = listSuites(cwd)
    if (json) return { type: 'text', value: JSON.stringify({ suites: names }, null, 2) }
    if (names.length === 0) {
      return { type: 'text', value: 'No eval suites yet. Create one: ur eval init' }
    }
    return { type: 'text', value: `Eval suites:\n${names.map(n => `  - ${n}`).join('\n')}` }
  }

  if (command === 'dashboard') {
    const path = writeDashboard(cwd)
    return {
      type: 'text',
      value: `Wrote eval dashboard to ${path}\nOpen it in a browser (local-first, no network).`,
    }
  }

  if (command === 'builtin' || command === 'benchmarks') {
    if (!name || name === 'list') {
      const ids = listBuiltinSuiteIds()
      if (json) return { type: 'text', value: JSON.stringify({ suites: ids }, null, 2) }
      return {
        type: 'text',
        value: `Built-in benchmark suites:\n${ids.map(id => `  - ${id}`).join('\n')}`,
      }
    }
    const suite = getBuiltinSuite(name as BuiltinSuiteId)
    if (!suite) {
      return {
        type: 'text',
        value: `Unknown builtin suite: ${name}\nAvailable: ${listBuiltinSuiteIds().join(', ')}`,
      }
    }
    const { path, created } = installBuiltinSuite(cwd, name as BuiltinSuiteId, { force })
    return {
      type: 'text',
      value: `${created ? 'Installed' : 'Already exists'} builtin suite ${name} at ${path}\nRun: ur eval run ${suite.name}`,
    }
  }

  if (command === 'leaderboard') {
    const format = (optionValue(tokens, '--format') ?? 'html') as 'html' | 'json' | 'md'
    const reports: EvalReport[] = name
      ? [loadReport(cwd, name)].filter((r): r is EvalReport => r !== null)
      : loadAllReports(cwd)
    if (reports.length === 0) {
      return {
        type: 'text',
        value: name
          ? `No saved report for ${name}. Run it first: ur eval run ${name}`
          : 'No saved reports yet. Run an eval first.',
      }
    }
    const outPath = buildLeaderboard(cwd, reports, { format, runId: getSessionId() })
    return { type: 'text', value: `Wrote leaderboard to ${outPath}` }
  }

  if (command === 'report') {
    const report = loadReport(cwd, name)
    if (!report) {
      return {
        type: 'text',
        value: `No saved report for ${name}. Run it first: ur eval run ${name}`,
      }
    }
    if (tokens.includes('--dashboard')) {
      const { buildDashboardHtml } = await import('../../services/agents/evals.js')
      const html = buildDashboardHtml([report], [])
      const dir = join(evalsDir(cwd), '.dashboards')
      mkdirSync(dir, { recursive: true })
      const path = join(dir, `${suiteSlug(report.name)}.html`)
      writeFileSync(path, html)
      return { type: 'text', value: `Wrote single-suite dashboard to ${path}` }
    }
    return { type: 'text', value: formatEvalReport(report, json) }
  }

  if (command === 'bench' || command === 'benchmark') {
    if (!name || name === 'list') {
      return { type: 'text', value: formatBenchmarkAdapters(json) }
    }
    if (!isBenchmarkAdapter(name)) {
      return {
        type: 'text',
        value: `Unknown benchmark adapter: ${name}\nAvailable: ${BENCHMARK_ADAPTERS.map(adapter => adapter.id).join(', ')}`,
      }
    }
    const file = optionValue(tokens, '--file')
    if (!file) {
      return {
        type: 'text',
        value: `Provide --file <local JSON or JSONL export> for ${name}.`,
      }
    }
    const limitRaw = Number(optionValue(tokens, '--limit') ?? '0')
    const suiteName = optionValue(tokens, '--name') ?? name
    try {
      const result = importBenchmarkSuite(cwd, name, file, {
        name: suiteName,
        limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined,
        force,
      })
      if (json) return { type: 'text', value: JSON.stringify(result, null, 2) }
      return {
        type: 'text',
        value:
          `${BENCHMARK_ADAPTERS.find(adapter => adapter.id === name)?.name ?? name} suite ready: ${result.suite.name}\n` +
          `records read: ${result.records}\n` +
          `cases written: ${result.suite.cases.length}\n` +
          `path: ${result.path}\n` +
          `Run it locally: ur eval run ${result.suite.name}`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { type: 'text', value: `Failed to import benchmark suite: ${message}` }
    }
  }

  if (!name) {
    return { type: 'text', value: `Usage: ur eval ${command} <suite>` }
  }
  const suite = loadSuite(cwd, name)

  if (command === 'validate') {
    if (!suite) return notFound(name)
    const validation = validateEvalSuite(suite)
    if (json) return { type: 'text', value: JSON.stringify(validation, null, 2) }
    return { type: 'text', value: formatSuiteValidation(suite, validation) }
  }

  if (command === 'report') {
    const report = loadReport(cwd, name)
    if (!report) {
      return {
        type: 'text',
        value: `No saved report for ${name}. Run it first: ur eval run ${name}`,
      }
    }
    return { type: 'text', value: formatEvalReport(report, json) }
  }

  if (command === 'run') {
    if (!suite) return notFound(name)
    const validation = validateEvalSuite(suite)
    if (!validation.valid) {
      return { type: 'text', value: formatSuiteValidation(suite, validation) }
    }
    const dryRun = tokens.includes('--dry-run')
    const skipPermissions =
      tokens.includes('--skip-permissions') ||
      tokens.includes('--dangerously-skip-permissions')
    const category = optionValue(tokens, '--category')
    const maxTurnsValue = Number(optionValue(tokens, '--max-turns') ?? '20')
    const maxTurns =
      Number.isFinite(maxTurnsValue) && maxTurnsValue > 0 ? maxTurnsValue : 20
    const model = optionValue(tokens, '--model')
    const offline = tokens.includes('--offline') || isNetworkRestricted()
    const runner = dryRun
      ? makeDryEvalRunner()
      : makeCliEvalRunner({ cwd, maxTurns, skipPermissions, model })
    if (offline && !dryRun) {
      process.env.UR_OFFLINE = '1'
    }
    const judge = dryRun
      ? makeDryJudgeRunner()
      : makeCliJudgeRunner({ cwd, maxTurns, skipPermissions })

    const repeatRaw = Number(optionValue(tokens, '--repeat') ?? '1')
    const repeat = Number.isFinite(repeatRaw) && repeatRaw > 1 ? Math.floor(repeatRaw) : 1

    if (repeat > 1) {
      const reliability = await runSuiteReliability(suite, runner, {
        category,
        judge,
        trials: repeat,
      })
      if (!dryRun) saveReliabilityReport(cwd, reliability)
      return { type: 'text', value: formatReliabilityReport(reliability, json) }
    }

    const writeMetrics = tokens.includes('--metrics')
    const runId = getSessionId()
    process.env.UR_RUN_ID = runId
    const report: EvalReport = await runSuite(suite, runner, { category, judge })
    if (!dryRun) saveReport(cwd, report, { runId })
    if (writeMetrics) {
      const { writeRunMetrics } = await import('../../services/agents/evals.js')
      for (const item of report.cases) {
        if (item.metrics) writeRunMetrics(cwd, suite.name, item.id, item.metrics)
      }
    }
    if (json) return { type: 'text', value: formatEvalReport(report, true) }
    const header = dryRun ? '(dry run — no model calls; grading exercised offline)\n\n' : ''
    return { type: 'text', value: `${header}${formatEvalReport(report, false)}` }
  }

  if (command === 'route') {
    const task = positional.slice(1).join(' ') || name || ''
    if (!task) {
      return {
        type: 'text',
        value: 'Usage: ur eval route "<task>" [--strategy auto|cheap|strong|default] [--json]',
      }
    }
    const { listModelCapabilities } = await import('../../commands/model-doctor/model-doctor.js')
    const { resolveModelForTask } = await import('../../services/agents/modelRouter.js')
    const { loadModelPool } = await import('../../services/agents/modelPool.js')
    const strategy = (optionValue(tokens, '--strategy') ?? 'auto') as import('../../services/agents/modelRouter.js').RouteStrategy
    const { models } = await listModelCapabilities()
    const pool = loadModelPool(cwd)
    const resolved = resolveModelForTask(task, strategy, pool, models, { cwd })
    const result = {
      task,
      strategy,
      resolved: resolved ?? null,
      pool: { cheap: pool.cheap, strong: pool.strong, default: pool.default },
    }
    return {
      type: 'text',
      value: json ? JSON.stringify(result, null, 2) : `Task: ${task}\nStrategy: ${strategy}\nResolved model: ${resolved ?? 'none'}`,
    }
  }

  if (command === 'compare') {
    const suiteName = positional[1]
    const labelNames = positional.slice(2)
    if (!suite || labelNames.length < 2) {
      return {
        type: 'text',
        value:
          'Usage: ur eval compare <suite> <label1> <label2> [...]\n' +
          'Labels are model/runner names (e.g., pool codex claude). Each label sets UR_MODEL for its run.',
      }
    }
    const dryRun = tokens.includes('--dry-run')
    const skipPermissions =
      tokens.includes('--skip-permissions') ||
      tokens.includes('--dangerously-skip-permissions')
    const maxTurnsValue = Number(optionValue(tokens, '--max-turns') ?? '20')
    const maxTurns =
      Number.isFinite(maxTurnsValue) && maxTurnsValue > 0 ? maxTurnsValue : 20
    const offline = tokens.includes('--offline') || isNetworkRestricted()
    const baseJudge = dryRun
      ? makeDryJudgeRunner()
      : makeCliJudgeRunner({ cwd, maxTurns, skipPermissions })

    const labels: CompareLabel[] = labelNames.map(name => ({
      name,
      model: name,
      runnerFactory: () => {
        const base = dryRun
          ? makeDryEvalRunner()
          : makeCliEvalRunner({ cwd, maxTurns, skipPermissions, model: name })
        return async evalCase => {
          const oldModel = process.env.UR_MODEL
          const oldOffline = process.env.UR_OFFLINE
          process.env.UR_MODEL = name
          if (offline) process.env.UR_OFFLINE = '1'
          try {
            return await base(evalCase)
          } finally {
            process.env.UR_MODEL = oldModel
            process.env.UR_OFFLINE = oldOffline
          }
        }
      },
    }))

    const runId = getSessionId()
    process.env.UR_RUN_ID = runId
    const report = await runSuiteCompare(suite, labels, { judge: baseJudge })
    return { type: 'text', value: formatCompareReport(report, json) }
  }

  if (command === 'runs' || command === 'run-artifacts') {
    const runId = name
    if (!runId) {
      const manifests = loadRunManifests(cwd)
      if (json) return { type: 'text', value: JSON.stringify({ runs: manifests.map(m => m.runId) }, null, 2) }
      if (manifests.length === 0) return { type: 'text', value: 'No run artifacts yet.' }
      return {
        type: 'text',
        value: manifests.map(m => `- ${m.runId} (${m.artifacts.length} artifacts) — ${m.startedAt}`).join('\n'),
      }
    }
    const manifest = readRunManifest(cwd, runId)
    if (!manifest) return { type: 'text', value: `No run manifest for ${runId}.` }
    if (json) return { type: 'text', value: JSON.stringify(manifest, null, 2) }
    const lines = [
      `Run: ${manifest.runId}`,
      `Started: ${manifest.startedAt}`,
      `Artifacts: ${manifest.artifacts.length}`,
      '',
      ...manifest.artifacts.map(a => `- ${a.kind}: ${a.path}${a.title ? ` — ${a.title}` : ''}`),
    ]
    return { type: 'text', value: lines.join('\n') }
  }

  return { type: 'text', value: `Unknown eval command: ${command}` }
}
