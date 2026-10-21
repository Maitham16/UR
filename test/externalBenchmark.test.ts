import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { externalBenchmarkPlan, runExternalBenchmark } from '../scripts/benchmark-external.mjs'

const roots: string[] = []
function temporary() { const dir = mkdtempSync(join(tmpdir(), 'ur-external-benchmark-')); roots.push(dir); return dir }
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }) })

test('external runner preserves argument boundaries and reports actual failure', () => {
  const directory = temporary()
  const config = join(directory, 'config.json')
  writeFileSync(config, JSON.stringify({ benchmark: 'terminal-bench', command: process.execPath, args: ['-e', 'console.log(JSON.stringify(process.argv.slice(1))); process.exit(7)', 'literal $(do-not-execute) and spaces'] }))
  const report = runExternalBenchmark(externalBenchmarkPlan('terminal-bench', ['--config', config]), { outputRoot: directory })
  expect(report.status).toBe('failed')
  expect(report.exitCode).toBe(7)
  expect(report.measured).toBe(false)
  expect(readFileSync(join(report.directory, 'stdout.log'), 'utf8')).toContain('literal $(do-not-execute) and spaces')
})

test('missing runner skips only on explicit request and never claims a measurement', () => {
  const plan = externalBenchmarkPlan('terminal-bench', ['--allow-missing'], { TERMINAL_BENCH_COMMAND: 'no-such-ur-benchmark-runner' })
  const report = runExternalBenchmark(plan, { outputRoot: temporary() })
  expect(report.status).toBe('skipped')
  expect(report.measured).toBe(false)
  expect(report.exitCode).toBe(0)
})

test('external logs redact credential values and dry-run does not launch a process', () => {
  const directory = temporary()
  const config = join(directory, 'config.json')
  writeFileSync(config, JSON.stringify({ command: process.execPath, args: ['-e', 'console.log(process.env.TEST_API_KEY)'] }))
  const report = runExternalBenchmark(externalBenchmarkPlan('terminal-bench', ['--config', config]), { outputRoot: directory, env: { ...process.env, TEST_API_KEY: 'private-test-value' } })
  expect(readFileSync(join(report.directory, 'stdout.log'), 'utf8')).toContain('[redacted]')
  const dry = runExternalBenchmark(externalBenchmarkPlan('terminal-bench', ['--config', config, '--dry-run']))
  expect(dry.status).toBe('planned')
  expect(dry.directory).toBeUndefined()
})
