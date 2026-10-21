#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const names = ['swe-bench-lite', 'terminal-bench', 'aider-polyglot']

/** Explicit configuration avoids attributing a third-party agent's score to UR. */
export function externalBenchmarkPlan(benchmark, argv = [], env = process.env) {
  if (!names.includes(benchmark)) throw new Error(`Expected benchmark: ${names.join(', ')}`)
  let configPath, dryRun = false, allowMissing = false
  const forwarded = []
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--') { forwarded.push(...argv.slice(index + 1)); break }
    if (argv[index] === '--config') { configPath = argv[++index]; if (!configPath) throw new Error('--config requires a JSON path') }
    else if (argv[index] === '--dry-run') dryRun = true
    else if (argv[index] === '--allow-missing') allowMissing = true
    else forwarded.push(argv[index])
  }
  const config = configPath ? JSON.parse(readFileSync(resolve(configPath), 'utf8')) : {}
  if (config.benchmark && config.benchmark !== benchmark) throw new Error('Configuration benchmark does not match requested benchmark')
  const commands = { 'swe-bench-lite': env.SWEBENCH_LITE_COMMAND ?? 'python3', 'terminal-bench': env.TERMINAL_BENCH_COMMAND ?? 'harbor', 'aider-polyglot': env.AIDER_POLYGLOT_COMMAND }
  const defaults = { 'swe-bench-lite': ['-m', 'swebench.harness.run_evaluation', '--dataset_name', 'princeton-nlp/SWE-bench_Lite'], 'terminal-bench': ['run', '-a', 'benchmarks.harbor.ur_agent:UrAgent'], 'aider-polyglot': [] }
  const command = config.command ?? commands[benchmark]
  if (!Array.isArray(config.args ?? [])) throw new Error('Runner args must be an array of strings')
  const args = [...(config.args ?? defaults[benchmark]), ...forwarded]
  if (typeof command !== 'string' || !command || command.includes('\0')) throw new Error('Configure an actual executable in --config or the benchmark command environment variable')
  if (!args.every(arg => typeof arg === 'string' && !arg.includes('\0'))) throw new Error('Runner args must be an array of strings')
  if (config.env && (!Array.isArray(config.env) || !config.env.every(name => typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)))) throw new Error('env must list environment-variable names, never credential values')
  for (const name of config.env ?? []) if (!env[name]) throw new Error(`Required runner environment variable is missing: ${name}`)
  return { benchmark, command, args, cwd: config.cwd ? resolve(dirname(resolve(configPath)), config.cwd) : root, dryRun, allowMissing, configurationSha256: createHash('sha256').update(JSON.stringify({ benchmark, command, args, config })).digest('hex') }
}

export function runExternalBenchmark(plan, options = {}) {
  const env = options.env ?? process.env
  const outputRoot = options.outputRoot ?? join(root, '.ur', 'evals', '.external')
  const redact = value => {
    let text = String(value)
    for (const [key, secret] of Object.entries(env)) if (secret && secret.length >= 6 && /key|token|secret|password|credential/i.test(key)) text = text.split(secret).join('[redacted]')
    return text
  }
  const safePlan = { ...plan, args: plan.args.map(redact) }
  if (plan.dryRun) return { ...safePlan, status: 'planned', measured: false, exitCode: 0 }
  const runId = randomUUID()
  const startedAt = new Date().toISOString()
  const directory = join(outputRoot, runId)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const result = spawnSync(plan.command, plan.args, { cwd: plan.cwd, env: { ...env, PYTHONPATH: [root, env.PYTHONPATH].filter(Boolean).join(process.platform === 'win32' ? ';' : ':') }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, timeout: options.timeoutMs ?? 24 * 60 * 60 * 1000 })
  const missing = result.error?.code === 'ENOENT'
  const status = missing && plan.allowMissing ? 'skipped' : result.error || result.signal || result.status !== 0 ? 'failed' : 'completed'
  const report = { ...safePlan, runId, startedAt, finishedAt: new Date().toISOString(), status, measured: false, note: 'Runner exit status is execution evidence; import independently verified task results before claiming a benchmark score.', exitCode: status === 'skipped' ? 0 : result.status ?? (missing ? 127 : 1), signal: result.signal, error: result.error ? redact(result.error.message) : undefined, directory }
  writeFileSync(join(directory, 'stdout.log'), redact(result.stdout ?? ''), { mode: 0o600 })
  writeFileSync(join(directory, 'stderr.log'), redact(result.stderr ?? ''), { mode: 0o600 })
  writeFileSync(join(directory, 'run.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  return report
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = runExternalBenchmark(externalBenchmarkPlan(process.argv[2], process.argv.slice(3)))
    console.log(JSON.stringify(report, null, 2))
    process.exitCode = report.exitCode
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
