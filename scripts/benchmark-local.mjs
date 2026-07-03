#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import { buildBenchmarkReport } from './benchmark-report.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const command = 'bun run benchmark:local'

const tasks = [
  ['simple-file-edit', 'simple file edit task', 'terminal-coding', ['test', 'test/fileops.test.ts']],
  ['repo-edit-apply', 'repository edit apply task', 'terminal-coding', ['test', 'test/repoEdit.test.ts']],
  ['repo-edit-ast', 'repository AST edit task', 'terminal-coding', ['test', 'test/repoEditAst.test.ts']],
  ['repo-edit-imports', 'repository import edit task', 'terminal-coding', ['test', 'test/repoEditImports.test.ts']],
  ['repo-edit-move', 'repository move edit task', 'terminal-coding', ['test', 'test/repoEditMove.test.ts']],
  ['failing-test-repair', 'failing test repair task', 'terminal-coding', ['test', 'test/testFirstLoop.test.ts']],
  ['provider-routing', 'provider routing task', 'provider-routing', ['test', 'test/providerRouting.test.ts']],
  ['provider-reliability', 'provider reliability task', 'provider-routing', ['test', 'test/providerReliability.test.ts']],
  ['provider-streaming', 'provider streaming task', 'provider-routing', ['test', 'test/providerStreaming.test.ts']],
  ['provider-tool-calls', 'provider tool-call task', 'tool-use', ['test', 'test/providerToolCalls.test.ts']],
  ['provider-multimodal', 'provider multimodal mapping task', 'provider-routing', ['test', 'test/providerMultimodal.test.ts']],
  ['sandbox-policy', 'sandbox denial task', 'sandbox-safety', ['test', 'test/safetyPolicy.test.ts']],
  ['safety-matrix', 'safety matrix proof task', 'sandbox-safety', ['test', 'test/safetyMatrix.test.ts']],
  ['sandbox-adapter', 'sandbox adapter task', 'sandbox-safety', ['test', 'test/sandboxAdapter.test.ts']],
  ['sandbox-profile', 'sandbox profile task', 'sandbox-safety', ['test', 'test/sandboxProfile.test.ts']],
  ['release-hygiene', 'release hygiene task', 'internal-regression', ['test', 'test/releaseHygiene.test.ts']],
  ['benchmark-schema', 'benchmark schema validation task', 'internal-regression', ['test', 'test/benchmarkReport.test.ts']],
  ['eval-compare', 'eval comparison task', 'internal-regression', ['test', 'test/evalCompare.test.ts']],
  ['tool-call-parsing', 'tool-call parsing task', 'tool-use', ['test', 'test/kimiToolCalls.test.ts']],
  ['multi-step-code-modification', 'multi-step code modification task', 'terminal-coding', ['test', 'test/typescriptEngine.test.ts']],
].map(([id, name, category, args]) => ({ id, name, category, args }))

function runTask(task) {
  const started = Date.now()
  const result = spawnSync('bun', task.args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      UR_BENCHMARK_LOCAL: '1',
    },
  })
  const durationMs = Date.now() - started
  const passed = result.status === 0
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
  return {
    id: task.id,
    name: task.name,
    category: task.category,
    passed,
    isError: result.error != null,
    durationMs,
    checks: [
      {
        name: `test command: bun ${task.args.join(' ')}`,
        passed,
      },
    ],
    outputPreview: output.slice(0, 1000),
  }
}

function validateReport(report) {
  const schema = JSON.parse(
    readFileSync(join(root, 'benchmarks', 'result.schema.json'), 'utf8'),
  )
  const validate = new Ajv2020({ strict: false }).compile(schema)
  if (!validate(report)) {
    throw new Error(
      `Local benchmark report failed schema validation: ${JSON.stringify(validate.errors, null, 2)}`,
    )
  }
}

function main() {
  const started = Date.now()
  const cases = tasks.map(runTask)
  const passed = cases.filter(item => item.passed).length
  const failed = cases.length - passed
  const evalReport = {
    name: 'local-regression',
    generatedAt: new Date().toISOString(),
    total: cases.length,
    passed,
    failed,
    passRate: cases.length === 0 ? 0 : passed / cases.length,
    totalDurationMs: Date.now() - started,
    cases,
  }
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  const report = buildBenchmarkReport(evalReport, {
    version,
    benchmarkName: 'local-regression',
    category: 'internal-regression',
    provider: process.env.UR_PROVIDER ?? 'local-regression',
    model: process.env.UR_MODEL ?? 'none',
    command,
    inputReport: null,
  })
  validateReport(report)
  const output = join(root, 'benchmarks', 'results', version, 'local-regression.json')
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Wrote local benchmark report: ${output}`)
  console.log(`Local regression benchmark: ${passed}/${cases.length} passed`)
  if (failed > 0) {
    process.exit(1)
  }
}

main()
