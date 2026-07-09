import { describe, expect, test } from 'bun:test'
import { BrowserTool } from '../src/tools/BrowserTool/BrowserTool.js'

describe('BrowserTool', () => {
  test('is disabled by default and enabled with env var', () => {
    const original = process.env.UR_BROWSER_TOOL
    try {
      delete process.env.UR_BROWSER_TOOL
      delete process.env.WEB_BROWSER_TOOL
      expect(BrowserTool.isEnabled()).toBe(false)
      process.env.UR_BROWSER_TOOL = '1'
      expect(BrowserTool.isEnabled()).toBe(true)
    } finally {
      if (original !== undefined) process.env.UR_BROWSER_TOOL = original
      else delete process.env.UR_BROWSER_TOOL
    }
  })

  test('fetch action returns page content', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response('<html><body>Hello</body></html>', {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/html' },
      })) as unknown as typeof fetch
    try {
      process.env.UR_BROWSER_TOOL = '1'
      // BrowserTool's concrete call(input) ignores context/permissions args.
      const result = await BrowserTool.call(
        { url: 'https://example.com', action: 'fetch' } as never,
      )
      const data = result.data as { success: boolean; text: string }
      expect(data.success).toBe(true)
      expect(data.text).toContain('Hello')
    } finally {
      globalThis.fetch = originalFetch
      delete process.env.UR_BROWSER_TOOL
    }
  })
})
