import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import { benchmarkCategories, buildBenchmarkReport } from '../scripts/benchmark-report.mjs'

const repoRoot = join(import.meta.dir, '..')

function sampleEvalReport() {
  return {
    name: 'provider-routing',
    generatedAt: '2026-07-03T00:00:00.000Z',
    total: 2,
    passed: 1,
    failed: 1,
    passRate: 0.5,
    byCategory: { provider: { passed: 1, total: 2 } },
    totalDurationMs: 1234,
    totalInputTokens: 100,
    totalOutputTokens: 50,
    totalCostUSD: 0.01,
    cases: [
      {
        id: 'routes-openrouter',
        category: 'provider',
        passed: true,
        isError: false,
        durationMs: 100,
        checks: [],
        outputPreview: 'ok',
        metrics: { durationMs: 100, model: 'test-model' },
      },
      {
        id: 'rejects-bad-key',
        category: 'provider',
        passed: false,
        isError: false,
        durationMs: 200,
        checks: [{ name: 'test command: bun test', passed: false }],
        outputPreview: 'failed',
      },
    ],
  }
}

function benchmarkSchemaValidator() {
  const schema = JSON.parse(
    readFileSync(join(repoRoot, 'benchmarks', 'result.schema.json'), 'utf8'),
  )
  return new Ajv2020({ strict: false }).compile(schema)
}

describe('benchmark report generator', () => {
  test('converts eval reports into versioned benchmark results', () => {
    const report = buildBenchmarkReport(
      sampleEvalReport(),
      {
        version: '1.37.2',
        commit: 'abc123',
        date: '2026-07-03T12:00:00.000Z',
        benchmarkName: 'provider-routing',
        category: 'provider-routing',
        provider: 'openai-compatible',
        model: 'test-model',
        command: 'ur eval run provider-routing --metrics --json',
        bunVersion: '1.3.14',
      },
    )

    expect(report.agent.version).toBe('1.37.2')
    expect(report.agent.commit).toBe('abc123')
    expect(report.benchmark.category).toBe('provider-routing')
    expect(report.benchmark.taskCount).toBe(2)
    expect(report.runtime.provider).toBe('openai-compatible')
    expect(report.runtime.model).toBe('test-model')
    expect(report.results.passRate).toBe(0.5)
    expect(report.results.taskResults).toEqual([
      {
        id: 'routes-openrouter',
        name: 'routes-openrouter',
        category: 'provider',
        passed: true,
        wallTimeMs: 100,
        failureCategory: null,
      },
      {
        id: 'rejects-bad-key',
        name: 'rejects-bad-key',
        category: 'provider',
        passed: false,
        wallTimeMs: 200,
        failureCategory: 'verification-failure',
      },
    ])
    expect(report.results.failedTasks[0]).toMatchObject({
      id: 'rejects-bad-key',
      failureCategory: 'verification-failure',
    })
    expect(report.results.failureCategories).toEqual({ 'verification-failure': 1 })
    expect(report.results.tokenUsage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    })
    expect(report.results.costUSD).toBe(0.01)
    expect(report.reproduction.command).toContain('ur eval run provider-routing')
  })

  test('generated reports and the checked-in template validate against the benchmark schema', () => {
    const validate = benchmarkSchemaValidator()
    const report = buildBenchmarkReport(sampleEvalReport(), {
      version: '1.37.2',
      commit: 'abc123',
      benchmarkName: 'provider-routing',
      category: 'provider-routing',
      provider: 'openai-compatible',
      model: 'test-model',
      command: 'ur eval run provider-routing --metrics --json',
      bunVersion: '1.3.14',
    })
    expect(validate(report)).toBe(true)

    const template = JSON.parse(
      readFileSync(
        join(repoRoot, 'benchmarks', 'results', '1.37.2', 'TEMPLATE.json'),
        'utf8',
      ),
    )
    expect(validate(template)).toBe(true)
  })

  test('benchmark-report script writes schema-valid structured output', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ur-benchmark-report-'))
    try {
      const input = join(dir, 'eval-report.json')
      const output = join(dir, 'benchmark-result.json')
      writeFileSync(input, JSON.stringify(sampleEvalReport()))

      const result = spawnSync(
        'node',
        [
          join(repoRoot, 'scripts', 'benchmark-report.mjs'),
          '--input',
          input,
          '--output',
          output,
          '--category',
          'provider-routing',
          '--provider',
          'openai-compatible',
          '--model',
          'test-model',
          '--command',
          'ur eval run provider-routing --metrics --json',
        ],
        { cwd: repoRoot, encoding: 'utf8' },
      )

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Wrote benchmark report:')
      const report = JSON.parse(readFileSync(output, 'utf8'))
      expect(benchmarkSchemaValidator()(report)).toBe(true)
      expect(report.template).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('lists supported benchmark categories', () => {
    expect(benchmarkCategories).toContain('internal-regression')
    expect(benchmarkCategories).toContain('terminal-coding')
    expect(benchmarkCategories).toContain('provider-routing')
    expect(benchmarkCategories).toContain('tool-use')
    expect(benchmarkCategories).toContain('sandbox-safety')
    expect(benchmarkCategories).toContain('swe-bench-lite')
    expect(benchmarkCategories).toContain('terminal-bench')
    expect(benchmarkCategories).toContain('aider-polyglot')
  })

  test('benchmark compare script summarizes two schema-valid reports', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ur-benchmark-compare-'))
    try {
      const before = join(dir, 'before.json')
      const after = join(dir, 'after.json')
      writeFileSync(
        before,
        JSON.stringify(
          buildBenchmarkReport(sampleEvalReport(), {
            version: '1.37.2',
            benchmarkName: 'before',
            category: 'internal-regression',
            provider: 'local',
            model: 'none',
          }),
        ),
      )
      writeFileSync(
        after,
        JSON.stringify(
          buildBenchmarkReport(
            { ...sampleEvalReport(), name: 'after', passed: 2, failed: 0, passRate: 1 },
            {
              version: '1.37.2',
              benchmarkName: 'after',
              category: 'internal-regression',
              provider: 'local',
              model: 'none',
            },
          ),
        ),
      )

      const result = spawnSync(
        'node',
        [join(repoRoot, 'scripts', 'benchmark-compare.mjs'), before, after],
        { cwd: repoRoot, encoding: 'utf8' },
      )

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Benchmark comparison:')
      expect(result.stdout).toContain('pass-rate delta')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('external benchmark commands skip safely when dependency is missing', () => {
    const result = spawnSync(
      'node',
      [join(repoRoot, 'scripts', 'benchmark-external.mjs'), 'swe-bench-lite'],
      {
        cwd: repoRoot,
        env: { ...process.env, SWEBENCH_LITE_COMMAND: 'ur-missing-swebench-command' },
        encoding: 'utf8',
      },
    )

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('skipped')
  })
})
