import {
  BENCHMARK_ADAPTERS,
  type BenchmarkAdapterId,
  type EvalReport,
  formatEvalReport,
  formatReliabilityReport,
  formatSuiteValidation,
  importBenchmarkSuite,
  listSuites,
  loadReport,
  loadSuite,
  makeCliEvalRunner,
  makeCliJudgeRunner,
  makeDryEvalRunner,
  makeDryJudgeRunner,
  runSuite,
  runSuiteReliability,
  saveReliabilityReport,
  saveReport,
  scaffoldEvals,
  validateEvalSuite,
  writeDashboard,
} from '../../services/agents/evals.js'
import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'

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

export const call: LocalCommandCall = async (args: string) => {
  const cwd = getCwd()
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const force = tokens.includes('--force')
  const positional = tokens.filter(token => !token.startsWith('--'))
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
    const runner = dryRun
      ? makeDryEvalRunner()
      : makeCliEvalRunner({ cwd, maxTurns, skipPermissions })
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

    const report: EvalReport = await runSuite(suite, runner, { category, judge })
    if (!dryRun) saveReport(cwd, report)
    if (json) return { type: 'text', value: formatEvalReport(report, true) }
    const header = dryRun ? '(dry run — no model calls; grading exercised offline)\n\n' : ''
    return { type: 'text', value: `${header}${formatEvalReport(report, false)}` }
  }

  return { type: 'text', value: `Unknown eval command: ${command}` }
}
