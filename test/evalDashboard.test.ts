import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildDashboardHtml,
  writeRunMetrics,
  loadRunMetrics,
  type EvalReport,
} from '../src/services/agents/evals.js'

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function makeReport(): EvalReport {
  return {
    name: 'demo',
    generatedAt: new Date().toISOString(),
    total: 2,
    passed: 1,
    failed: 1,
    passRate: 0.5,
    byCategory: { coding: { passed: 1, total: 2 } },
    totalDurationMs: 2500,
    totalCostUSD: 0.012,
    totalInputTokens: 300,
    totalOutputTokens: 150,
    totalFilesChanged: 3,
    totalEditCount: 11,
    totalCommandFailures: 1,
    totalHumanEditsNeeded: 0,
    totalHumanInterventions: 0,
    testsPassed: 1,
    testsFailed: 1,
    testPassRate: 0.5,
    cases: [
      {
        id: 'fix-1',
        category: 'coding',
        passed: true,
        isError: false,
        durationMs: 1200,
        checks: [{ name: 'contains', passed: true }],
        outputPreview: 'done',
        metrics: {
          durationMs: 1200,
          costUSD: 0.006,
          inputTokens: 150,
          outputTokens: 75,
          model: 'claude-sonnet-4',
          filesChanged: 2,
          editCount: 11,
          insertions: 10,
          deletions: 1,
          testPassed: true,
          testCommand: 'bun test test/parser.test.ts',
          commandFailures: 0,
          humanEditsNeeded: 0,
        },
      },
      {
        id: 'fix-2',
        category: 'coding',
        passed: false,
        isError: false,
        durationMs: 1300,
        checks: [{ name: 'contains', passed: false }],
        outputPreview: 'failed to apply',
        metrics: {
          durationMs: 1300,
          costUSD: 0.006,
          inputTokens: 150,
          outputTokens: 75,
          model: 'gpt-4o',
          filesChanged: 1,
          editCount: 0,
          insertions: 0,
          deletions: 0,
          testPassed: false,
          testCommand: 'bun test test/parser.test.ts',
          commandFailures: 1,
          humanEditsNeeded: 0,
        },
      },
    ],
  }
}

describe('eval dashboard', () => {
  test('dashboard contains summary cards and timeline columns', () => {
    const html = buildDashboardHtml([makeReport()], [])
    expect(html).toContain('Pass rate')
    expect(html).toContain('Test pass rate')
    expect(html).toContain('Cost')
    expect(html).toContain('Files changed')
    expect(html).toContain('Edit count')
    expect(html).toContain('Tests passed')
    expect(html).toContain('Command failures')
    expect(html).toContain('Human intervention')
    expect(html).toContain('Task timeline')
    expect(html).toContain('model used')
    expect(html).toContain('commands run')
    expect(html).toContain('diffs produced')
    expect(html).toContain('edit count')
    expect(html).toContain('tests passed/failed')
    expect(html).toContain('command failures')
    expect(html).toContain('human intervention')
    expect(html).toContain('fix-1')
    expect(html).toContain('claude-sonnet-4')
    expect(html).toContain('gpt-4o')
    expect(html).toContain('bun test test/parser.test.ts')
  })

  test('dashboard escapes HTML in output previews and ids', () => {
    const report = makeReport()
    report.cases[0].id = 'a<b>c</b>'
    report.cases[0].outputPreview = '<script>alert(1)</script>'
    const html = buildDashboardHtml([report], [])
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('a<b>c</b>')
  })

  test('writeRunMetrics and loadRunMetrics round-trip', () => {
    const dir = tempDir('ur-eval-runs-')
    const metrics = { durationMs: 900, costUSD: 0.001, inputTokens: 10 }
    const path = writeRunMetrics(dir, 's1', 'case-a', metrics)
    const loaded = loadRunMetrics(dir, 's1', 'case-a')
    expect(loaded?.costUSD).toBe(0.001)
    expect(path).toContain('.ur/evals/.runs/s1/case-a.json')
  })
})
