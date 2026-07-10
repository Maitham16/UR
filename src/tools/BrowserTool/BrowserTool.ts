import { z } from 'zod/v4'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
// Type-only import (erased at compile). playwright-core is optional at
// runtime: loading it eagerly would crash the whole CLI at startup for
// users without it and force the bundler to inline playwright.
import type { Browser, BrowserContext, Page } from 'playwright-core'

type ChromiumLauncher = (typeof import('playwright-core'))['chromium']
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { assertPublicUrl } from '../WebFetchTool/utils.js'

const BROWSER_TOOL_NAME = 'Browser'

const inputSchema = lazySchema(() =>
  z.strictObject({
    url: z.string().url().optional().describe('The URL to navigate to or fetch (required except for close)'),
    action: z
      .enum(['goto', 'click', 'type', 'screenshot', 'evaluate', 'close', 'fetch'])
      .default('fetch')
      .describe('Browser action to perform'),
    selector: z.string().optional().describe('CSS selector for click/type actions'),
    text: z.string().optional().describe('Text to type'),
    expression: z.string().optional().describe('JavaScript expression to evaluate in the page'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    url: z.string().optional(),
    title: z.string().optional(),
    text: z.string().optional(),
    result: z.unknown().optional(),
    screenshot: z.string().optional().describe('Base64 PNG screenshot'),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

function isEnabled(): boolean {
  return isEnvTruthy(process.env.UR_BROWSER_TOOL) || isEnvTruthy(process.env.WEB_BROWSER_TOOL)
}

async function runFetch(input: z.infer<InputSchema>): Promise<Output> {
  if (!input.url) return { success: false, error: 'url is required for fetch' }
  await assertPublicUrl(input.url)
  const response = await fetch(input.url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  })
  const redirectUrl = response.headers.get('location')
  if (response.status >= 300 && response.status < 400 && redirectUrl) {
    return {
      success: false,
      url: input.url,
      error: `Redirect requires a new approved request: ${new URL(redirectUrl, input.url).toString()}`,
    }
  }
  const bytes = await response.arrayBuffer()
  if (bytes.byteLength > 10 * 1024 * 1024) {
    return { success: false, url: input.url, error: 'Browser fetch response exceeds the 10 MiB limit' }
  }
  const text = new TextDecoder().decode(bytes)
  return {
    success: response.status >= 200 && response.status < 300,
    url: input.url,
    text: text.slice(0, 50_000),
    error: response.status >= 200 && response.status < 300 ? undefined : `HTTP ${response.status}`,
  }
}

type BrowserSession = { browser: Browser; context: BrowserContext; page: Page }
let activeSession: BrowserSession | undefined
let sessionPromise: Promise<BrowserSession> | undefined

let playwrightModule: typeof import('playwright-core') | null = null

/** Lazy, optional playwright loader — interactive actions need it; fetch does not. */
async function loadChromium(): Promise<ChromiumLauncher> {
  try {
    playwrightModule ??= await import('playwright-core')
  } catch {
    throw new Error(
      'Interactive browser actions need playwright-core (npm i -g playwright-core, or use action: "fetch" / the /chrome integration).',
    )
  }
  return playwrightModule.chromium
}

function findBrowserExecutable(chromium: ChromiumLauncher): string | undefined {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  if (configured && existsSync(configured)) return configured
  const candidates = [
    chromium.executablePath(),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    for (const binary of ['google-chrome', 'chromium', 'chromium-browser', 'msedge']) {
      candidates.push(join(dir, binary))
    }
  }
  return candidates.find(candidate => candidate && existsSync(candidate))
}

async function createSession(): Promise<BrowserSession> {
  const chromium = await loadChromium()
  const executablePath = findBrowserExecutable(chromium)
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  })
  const context = await browser.newContext({ serviceWorkers: 'block' })
  const page = await context.newPage()
  await page.route('**/*', async route => {
    const url = route.request().url()
    if (/^(about:|blob:|data:)/.test(url)) {
      await route.continue()
      return
    }
    try {
      await assertPublicUrl(url)
      await route.continue()
    } catch {
      await route.abort('blockedbyclient')
    }
  })
  const session = { browser, context, page }
  browser.once('disconnected', () => {
    if (activeSession?.browser === browser) activeSession = undefined
  })
  activeSession = session
  return session
}

async function getSession(): Promise<BrowserSession> {
  if (activeSession?.browser.isConnected()) return activeSession
  sessionPromise ??= createSession().finally(() => {
    sessionPromise = undefined
  })
  return sessionPromise
}

async function closeSession(): Promise<Output> {
  const session = activeSession
  activeSession = undefined
  if (session) await session.browser.close()
  return { success: true }
}

async function runPlaywright(input: z.infer<InputSchema>): Promise<Output> {
  if (input.action === 'close') return closeSession()
  if (!input.url) return { success: false, error: `url is required for ${input.action}` }

  await assertPublicUrl(input.url)
  const { page } = await getSession()
  if (input.action === 'goto' || page.url() === 'about:blank') {
    await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  }

  let result: unknown
  let screenshot: string | undefined
  if (input.action === 'click') {
    if (!input.selector) return { success: false, error: 'selector is required for click' }
    await page.click(input.selector)
  } else if (input.action === 'type') {
    if (!input.selector || input.text === undefined) {
      return { success: false, error: 'selector and text are required for type' }
    }
    await page.fill(input.selector, input.text)
  } else if (input.action === 'evaluate') {
    if (!input.expression) return { success: false, error: 'expression is required for evaluate' }
    result = await page.evaluate(input.expression)
  } else if (input.action === 'screenshot') {
    screenshot = (await page.screenshot({ type: 'png' })).toString('base64')
  }

  return {
    success: true,
    url: page.url(),
    title: await page.title(),
    text: (await page.locator('body').innerText().catch(() => '')).slice(0, 50_000),
    result,
    screenshot,
  }
}

async function dispatch(input: z.infer<InputSchema>): Promise<Output> {
  if (input.action === 'fetch') {
    return runFetch(input)
  }
  return runPlaywright(input)
}

export const BrowserTool = buildTool({
  name: BROWSER_TOOL_NAME,
  searchHint: 'control a headless browser',
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  isEnabled,
  async description(input) {
    try {
      const hostname = new URL(input.url).hostname
      return `UR wants to use a browser on ${hostname}`
    } catch {
      return 'UR wants to use a browser'
    }
  },
  async prompt() {
    return 'Control a headless browser: goto/click/type/evaluate/screenshot/close/fetch. Requires playwright-core for interactive actions; fetch uses plain HTTP.'
  },
  userFacingName() {
    return 'Browser'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly(input) {
    return ['fetch', 'goto', 'evaluate', 'screenshot'].includes(input.action)
  },
  isDestructive(input) {
    return ['click', 'type'].includes(input.action)
  },
  toAutoClassifierInput(input) {
    return `${input.action} ${input.url ?? ''}`
  },
  async checkPermissions(input) {
    return {
      behavior: 'ask',
      message: `UR wants to use Browser to ${input.action} ${input.url}`,
      updatedInput: input,
    }
  },
  renderToolUseMessage() {
    return null
  },
  async validateInput(input) {
    if (input.action !== 'close' && !input.url) {
      return { result: false, message: `url is required for ${input.action}`, errorCode: 1 }
    }
    if (input.expression && input.expression.length > 10_000) {
      return { result: false, message: 'expression exceeds the 10,000-character limit', errorCode: 2 }
    }
    return { result: true }
  },
  async call(input) {
    const result = await dispatch(input)
    return { data: result }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: JSON.stringify(content),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
