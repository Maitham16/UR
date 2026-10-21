import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { z } from 'zod/v4'
import { findBrowserExecutable } from '../../utils/browserExecutable.js'
import { loadPlaywright } from '../../utils/playwrightRuntime.js'

const assertionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('nonblank') }),
  z.object({ type: z.literal('visible'), selector: z.string().min(1) }),
  z.object({ type: z.literal('text'), selector: z.string().min(1), contains: z.string() }),
  z.object({ type: z.literal('count'), selector: z.string().min(1), equals: z.number().int().nonnegative() }),
  z.object({ type: z.literal('title'), contains: z.string() }),
  z.object({ type: z.literal('url'), contains: z.string() }),
  z.object({ type: z.literal('expression'), expression: z.string().min(1), name: z.string().optional() }),
  z.object({ type: z.literal('no-console-errors') }),
  z.object({ type: z.literal('no-page-errors') }),
  z.object({ type: z.literal('no-horizontal-overflow') }),
])
export type BrowserAssertion = z.infer<typeof assertionSchema>
const legacyAssertions: Record<string, BrowserAssertion> = {
  'page is nonblank': { type: 'nonblank' },
  'primary navigation is visible': { type: 'visible', selector: 'nav, [role="navigation"]' },
  'no console errors': { type: 'no-console-errors' },
  'no page errors': { type: 'no-page-errors' },
  'no horizontal overflow': { type: 'no-horizontal-overflow' },
}
const stepSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('click'), selector: z.string().min(1) }),
  z.object({ action: z.literal('fill'), selector: z.string().min(1), text: z.string() }),
  z.object({ action: z.literal('press'), selector: z.string().min(1), key: z.string().min(1) }),
  z.object({ action: z.literal('waitFor'), selector: z.string().min(1) }),
  z.object({ action: z.literal('evaluate'), expression: z.string().min(1) }),
])
const fixtureSchema = z.object({
  name: z.string().trim().min(1),
  target: z.string().url().refine(value => ['http:', 'https:', 'file:'].includes(new URL(value).protocol), 'Use an http, https or file URL'),
  viewports: z.array(z.object({ name: z.string().min(1), width: z.number().int().positive().max(16384), height: z.number().int().positive().max(16384) })).min(1).optional(),
  assertions: z.array(z.union([assertionSchema, z.string().transform((value, context) => {
    const assertion = legacyAssertions[value.toLowerCase().trim()]
    if (assertion) return assertion
    if (value.startsWith('js:') && value.slice(3).trim()) return { type: 'expression' as const, expression: value.slice(3).trim() }
    context.addIssue({ code: 'custom', message: `Assertion is not executable: ${value}. Use a typed assertion or js: boolean expression.` })
    return z.NEVER
  })])).min(1),
  steps: z.array(stepSchema).optional(),
  timeoutMs: z.number().int().positive().max(300000).default(10000),
  settleMs: z.number().int().nonnegative().max(30000).default(100),
  failOnConsoleError: z.boolean().default(true),
  failOnPageError: z.boolean().default(true),
})
export type BrowserFixture = z.input<typeof fixtureSchema>
export function validateBrowserFixture(value: unknown): string[] {
  const result = fixtureSchema.safeParse(value)
  if (result.success) {
    const names = result.data.viewports?.map(item => item.name) ?? []
    return new Set(names).size === names.length ? [] : ['viewports: names must be unique']
  }
  const messages = (issues: typeof result.error.issues): string[] => issues.flatMap(issue =>
    issue.code === 'invalid_union' ? issue.errors.flatMap(errors => messages(errors)) : [`${issue.path.join('.') || 'fixture'}: ${issue.message}`],
  )
  return messages(result.error.issues)
}

type CheckResult = { assertion: BrowserAssertion; ok: boolean; error?: string }
type ViewportResult = {
  viewport: { name: string; width: number; height: number }
  ok: boolean
  url?: string
  status?: number
  checks: CheckResult[]
  consoleErrors: string[]
  pageErrors: string[]
  artifacts: Array<{ path: string; sha256: string }>
  error?: string
}

async function check(page: Page, assertion: BrowserAssertion, consoleErrors: string[], pageErrors: string[], timeout: number): Promise<void> {
  switch (assertion.type) {
    case 'visible': await page.locator(assertion.selector).first().waitFor({ state: 'visible', timeout }); return
    case 'nonblank':
      await page.waitForFunction(() => {
        const body = document.body
        return Boolean(body && (body.innerText.trim() || Array.from(body.querySelectorAll('canvas,svg,img,video')).some(element => {
          const rect = element.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden'
        })))
      }, undefined, { timeout }); return
    case 'text':
      await page.waitForFunction(({ selector, contains }) => Array.from(document.querySelectorAll(selector)).some(element => (element.textContent ?? '').includes(contains)), assertion, { timeout }); return
    case 'count': await page.waitForFunction(({ selector, equals }) => document.querySelectorAll(selector).length === equals, assertion, { timeout }); return
    case 'title': await page.waitForFunction(contains => document.title.includes(contains), assertion.contains, { timeout }); return
    case 'url': await page.waitForFunction(contains => location.href.includes(contains), assertion.contains, { timeout }); return
    case 'expression': await page.waitForFunction(expression => (0, eval)(expression) === true, assertion.expression, { timeout }); return
    case 'no-horizontal-overflow':
      if (!await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0) <= innerWidth + 1)) throw new Error('Document overflows viewport horizontally')
      return
    case 'no-console-errors': if (consoleErrors.length) throw new Error(consoleErrors.join('\n')); return
    case 'no-page-errors': if (pageErrors.length) throw new Error(pageErrors.join('\n')); return
  }
}

/** Fixtures are project-authored executable browser tests, run only on explicit request. */
export async function runBrowserFixture(value: unknown, options: { cwd: string; dryRun?: boolean; signal?: AbortSignal }) {
  const fixture = fixtureSchema.parse(value)
  const viewports = fixture.viewports ?? [{ name: 'desktop', width: 1440, height: 900 }]
  if (new Set(viewports.map(item => item.name)).size !== viewports.length) throw new Error('Viewport names must be unique')
  if (options.dryRun) return { name: fixture.name, target: fixture.target, dryRun: true, viewports, assertions: fixture.assertions, steps: fixture.steps ?? [] }
  const startedAt = new Date().toISOString()
  const id = randomUUID()
  const artifactDirectory = join(options.cwd, '.ur', 'browser-qa', '.results', id)
  mkdirSync(artifactDirectory, { recursive: true, mode: 0o700 })
  const results: ViewportResult[] = []
  let browser: Browser | undefined
  let error: string | undefined
  const abort = () => { void browser?.close().catch(() => {}) }
  options.signal?.addEventListener('abort', abort, { once: true })
  try {
    options.signal?.throwIfAborted()
    const { chromium } = await loadPlaywright()
    const executablePath = findBrowserExecutable(chromium)
    if (!executablePath) throw new Error('Install Chrome, Chromium or Edge, or set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH. UR does not require a separate Bun installation.')
    browser = await chromium.launch({ headless: true, executablePath })
    options.signal?.throwIfAborted()
    for (const [index, viewport] of viewports.entries()) {
      const result: ViewportResult = { viewport, ok: false, checks: [], consoleErrors: [], pageErrors: [], artifacts: [] }
      results.push(result)
      let context: BrowserContext | undefined
      let page: Page | undefined
      const artifact = (path: string) => result.artifacts.push({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') })
      try {
        options.signal?.throwIfAborted()
        context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, serviceWorkers: 'block' })
        context.setDefaultTimeout(fixture.timeoutMs)
        await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
        page = await context.newPage()
        page.on('console', message => { if (message.type() === 'error') result.consoleErrors.push(message.text()) })
        page.on('pageerror', exception => result.pageErrors.push(exception.message))
        const response = await page.goto(fixture.target, { waitUntil: 'load', timeout: fixture.timeoutMs })
        result.url = page.url()
        result.status = response?.status()
        if (response && !response.ok()) throw new Error(`Navigation returned HTTP ${response.status()}`)
        for (const step of fixture.steps ?? []) {
          options.signal?.throwIfAborted()
          if (step.action === 'click') await page.locator(step.selector).click()
          else if (step.action === 'fill') await page.locator(step.selector).fill(step.text)
          else if (step.action === 'press') await page.locator(step.selector).press(step.key)
          else if (step.action === 'waitFor') await page.locator(step.selector).waitFor({ state: 'visible' })
          else await page.evaluate(step.expression)
        }
        if (fixture.settleMs) await page.waitForTimeout(fixture.settleMs)
        for (const assertion of fixture.assertions) {
          options.signal?.throwIfAborted()
          try { await check(page, assertion, result.consoleErrors, result.pageErrors, fixture.timeoutMs); result.checks.push({ assertion, ok: true }) }
          catch (exception) { result.checks.push({ assertion, ok: false, error: String(exception) }) }
        }
        result.ok = result.checks.every(item => item.ok) && (!fixture.failOnConsoleError || result.consoleErrors.length === 0) && (!fixture.failOnPageError || result.pageErrors.length === 0)
      } catch (exception) { result.error = String(exception) }
      finally {
        if (page && !page.isClosed()) {
          try { const path = join(artifactDirectory, `${index}.png`); await page.screenshot({ path, fullPage: true, timeout: fixture.timeoutMs }); artifact(path) }
          catch (exception) { result.error = `${result.error ?? ''}\nScreenshot: ${String(exception)}`.trim(); result.ok = false }
        }
        if (context) {
          try { const path = join(artifactDirectory, `${index}.trace.zip`); await context.tracing.stop({ path }); artifact(path) }
          catch (exception) { result.error = `${result.error ?? ''}\nTrace: ${String(exception)}`.trim(); result.ok = false }
          await context.close().catch(() => {})
        }
      }
    }
  } catch (exception) { error = String(exception) }
  finally { options.signal?.removeEventListener('abort', abort); await browser?.close().catch(() => {}) }
  const report = { id, name: fixture.name, target: fixture.target, startedAt, finishedAt: new Date().toISOString(), fixtureSha256: createHash('sha256').update(JSON.stringify(fixture)).digest('hex'), ok: !error && !options.signal?.aborted && results.length === viewports.length && results.every(item => item.ok), viewports: results, artifactDirectory, ...(error ? { error } : {}) }
  writeFileSync(join(artifactDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  return report
}
