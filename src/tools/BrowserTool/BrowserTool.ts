import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

const BROWSER_TOOL_NAME = 'Browser'

const inputSchema = lazySchema(() =>
  z.strictObject({
    url: z.string().url().describe('The URL to navigate to or fetch'),
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
  const response = await fetch(input.url, { signal: AbortSignal.timeout(30_000) })
  const text = await response.text()
  return {
    success: response.ok,
    url: input.url,
    text: text.slice(0, 50_000),
    error: response.ok ? undefined : `HTTP ${response.status}`,
  }
}

async function runPlaywright(input: z.infer<InputSchema>): Promise<Output> {
  const script = `
    const { chromium } = require('playwright-core');
    (async () => {
      const browser = await chromium.launch();
      const page = await browser.newPage();
      await page.goto(${JSON.stringify(input.url)});
      const title = await page.title();
      let result = null;
      let screenshot = null;
      ${input.action === 'click' && input.selector ? `await page.click(${JSON.stringify(input.selector)});` : ''}
      ${input.action === 'type' && input.selector && input.text ? `await page.fill(${JSON.stringify(input.selector)}, ${JSON.stringify(input.text)});` : ''}
      ${input.action === 'evaluate' && input.expression ? `result = await page.evaluate(() => { return ${input.expression}; });` : ''}
      ${input.action === 'screenshot' ? `screenshot = (await page.screenshot({ encoding: 'base64', type: 'png' })).toString();` : ''}
      const text = await page.evaluate(() => document.body?.innerText || '');
      await browser.close();
      console.log(JSON.stringify({ success: true, title, text: text.slice(0, 50000), result, screenshot }));
    })().catch(e => { console.log(JSON.stringify({ success: false, error: e.message })); process.exit(1); });
  `
  const result = await execFileNoThrow('node', ['-e', script], { timeout: 120_000 })
  try {
    return JSON.parse(result.stdout) as Output
  } catch {
    return {
      success: false,
      error: result.error || result.stderr || 'browser script failed',
    }
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
    return true
  },
  isReadOnly(input) {
    return ['fetch', 'goto', 'evaluate', 'screenshot'].includes(input.action)
  },
  isDestructive(input) {
    return ['click', 'type'].includes(input.action)
  },
  toAutoClassifierInput(input) {
    return `${input.action} ${input.url}`
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
