import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadPlaywright } from '../src/utils/playwrightRuntime.js'
import { findBrowserExecutable } from '../src/utils/browserExecutable.js'
import { runBrowserFixture, validateBrowserFixture } from '../src/services/agents/browserQa.js'

test('browser QA rejects unevaluable prose and malformed viewports', () => {
  expect(validateBrowserFixture({ name: 'bad', target: 'https://example.com', assertions: ['looks beautiful'] }).join(' ')).toContain('not executable')
  expect(validateBrowserFixture({ name: 'bad', target: 'javascript:alert(1)', assertions: ['page is nonblank'] }).length).toBeGreaterThan(0)
  expect(validateBrowserFixture({ name: 'bad', target: 'https://example.com', assertions: [], viewports: [] }).length).toBeGreaterThan(0)
})

test('browser QA dry-run resolves legacy assertions without executing code', async () => {
  const result = await runBrowserFixture({ name: 'dry', target: 'https://example.com', assertions: ['page is nonblank', 'js: window.ready === true'] }, { cwd: '/unused', dryRun: true })
  if (!('dryRun' in result)) throw new Error('Expected a dry run')
  expect(result.dryRun).toBe(true)
  expect(result.assertions).toEqual([{ type: 'nonblank' }, { type: 'expression', expression: 'window.ready === true' }])
})

const executable = findBrowserExecutable((await loadPlaywright()).chromium)
async function runRealFixture(...args: Parameters<typeof runBrowserFixture>) {
  const result = await runBrowserFixture(...args)
  if (!('ok' in result)) throw new Error('Expected an executed run')
  return result
}
if (!executable && process.env.UR_REQUIRE_BROWSER_QA_TESTS === '1') throw new Error('Browser QA integration tests require an installed Chromium browser')
describe.skipIf(!executable)('real browser QA', () => {
  let cwd: string
  beforeAll(() => { cwd = mkdtempSync(join(tmpdir(), 'ur-browser-qa-')) })
  afterAll(() => rmSync(cwd, { recursive: true, force: true }))
  function target(name: string, html: string) {
    const path = join(cwd, name)
    writeFileSync(path, html)
    return pathToFileURL(path).href
  }
  test('runs interaction and rendered assertions in each viewport and retains hashed artifacts', async () => {
    const result = await runRealFixture({ name: 'interactive', target: target('pass.html', '<title>QA test</title><nav>Home</nav><button onclick="document.querySelector(\'output\').textContent=\'done\'">Run</button><output>waiting</output>'), viewports: [{ name: 'mobile', width: 390, height: 844 }, { name: 'desktop', width: 1440, height: 900 }], steps: [{ action: 'click', selector: 'button' }], assertions: ['page is nonblank', 'primary navigation is visible', { type: 'text', selector: 'output', contains: 'done' }, { type: 'expression', expression: 'innerWidth === 390 || innerWidth === 1440' }, 'no console errors'] }, { cwd })
    expect(result.ok).toBe(true)
    expect(result.viewports).toHaveLength(2)
    for (const viewport of result.viewports) {
      expect(viewport.checks).toHaveLength(5)
      expect(viewport.artifacts).toHaveLength(2)
      for (const artifact of viewport.artifacts) { expect(readFileSync(artifact.path).length).toBeGreaterThan(0); expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/) }
    }
  }, 60000)
  test('fails a broken application despite successful document load and records actual errors', async () => {
    const result = await runRealFixture({ name: 'broken', target: target('broken.html', '<h1>Loading</h1><script>console.error("render failed");throw new Error("boom")</script>'), timeoutMs: 250, assertions: [{ type: 'visible', selector: '#rendered' }, 'no console errors', 'no page errors'] }, { cwd })
    expect(result.ok).toBe(false)
    expect(result.viewports[0].checks.every(item => !item.ok)).toBe(true)
    expect(result.viewports[0].pageErrors).toContain('boom')
    expect(result.viewports[0].consoleErrors).toContain('render failed')
    expect(result.viewports[0].artifacts).toHaveLength(2)
  }, 60000)
  test('does not treat truthy nonboolean expression or overflowing layout as a pass', async () => {
    const result = await runRealFixture({ name: 'strict', target: target('overflow.html', '<div style="width:3000px">wide</div>'), timeoutMs: 250, assertions: ['js: "false"', 'no horizontal overflow'] }, { cwd })
    expect(result.ok).toBe(false)
    expect(result.viewports[0].checks.every(item => !item.ok)).toBe(true)
  }, 60000)
  test('aborted run records failure instead of a partial pass', async () => {
    const result = await runRealFixture({ name: 'cancelled', target: 'https://example.com', assertions: ['page is nonblank'] }, { cwd, signal: AbortSignal.abort() })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Abort')
  })
})
