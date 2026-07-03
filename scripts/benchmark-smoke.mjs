#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import { buildBenchmarkReport } from './benchmark-report.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const command = 'bun run benchmark:smoke'

const tasks = [
  {
    id: 'simple-file-edit',
    name: 'simple file edit task',
    category: 'terminal-coding',
    args: ['test', 'test/fileops.test.ts'],
  },
  {
    id: 'failing-test-repair',
    name: 'failing test repair task',
    category: 'terminal-coding',
    args: ['test', 'test/testFirstLoop.test.ts'],
  },
  {
    id: 'provider-routing',
    name: 'provider routing task',
    category: 'provider-routing',
    args: ['test', 'test/providerRouting.test.ts', 'test/providerReliability.test.ts'],
  },
  {
    id: 'sandbox-denial',
    name: 'sandbox denial task',
    category: 'sandbox-safety',
    args: ['test', 'test/safetyPolicy.test.ts'],
  },
  {
    id: 'tool-call-parsing',
    name: 'tool-call parsing task',
    category: 'tool-use',
    args: ['test', 'test/kimiToolCalls.test.ts', 'test/providerToolCalls.test.ts'],
  },
  {
    id: 'multi-step-coding',
    name: 'multi-step coding task',
    category: 'terminal-coding',
    args: ['test', 'test/repoEdit.test.ts', 'test/repoEditAst.test.ts'],
  },
]

function runTask(task) {
  const started = Date.now()
  const result = spawnSync('bun', task.args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      UR_BENCHMARK_SMOKE: '1',
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
  const schema = JSON.parse(readFileSync(join(root, 'benchmarks', 'result.schema.json'), 'utf8'))
  const validate = new Ajv2020({ strict: false }).compile(schema)
  if (!validate(report)) {
    throw new Error(`Benchmark smoke report failed schema validation: ${JSON.stringify(validate.errors, null, 2)}`)
  }
}

function main() {
  const started = Date.now()
  const cases = tasks.map(runTask)
  const passed = cases.filter(item => item.passed).length
  const failed = cases.length - passed
  const evalReport = {
    name: 'local-smoke',
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
    benchmarkName: 'local-smoke',
    category: 'internal-regression',
    provider: process.env.UR_PROVIDER ?? 'local-regression',
    model: process.env.UR_MODEL ?? 'none',
    command,
    inputReport: null,
  })
  validateReport(report)
  const output = join(root, 'benchmarks', 'results', version, 'local-smoke.json')
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Wrote benchmark smoke report: ${output}`)
  console.log(`Local smoke benchmark: ${passed}/${cases.length} passed`)
  if (failed > 0) {
    process.exit(1)
  }
}

main()
