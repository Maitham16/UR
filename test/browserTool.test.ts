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
        // Use a public literal address so this mocked-fetch test never depends
        // on external DNS availability.
        { url: 'https://1.1.1.1', action: 'fetch' } as never,
      )
      const data = result.data as { success: boolean; text: string }
      expect(data.success).toBe(true)
      expect(data.text).toContain('Hello')
    } finally {
      globalThis.fetch = originalFetch
      delete process.env.UR_BROWSER_TOOL
    }
  })

  test('classifies WebMCP discovery as read-only and invocation as destructive', () => {
    expect(
      BrowserTool.isReadOnly({
        url: 'https://example.com',
        action: 'site_tools',
      } as never),
    ).toBe(true)
    expect(
      BrowserTool.isDestructive({
        url: 'https://example.com',
        action: 'site_tool_call',
        toolName: 'cart.checkout',
      } as never),
    ).toBe(true)
  })

  test('allows passive browsing while retaining approval for active page actions', async () => {
    expect(
      await BrowserTool.checkPermissions(
        { url: 'https://example.com', action: 'site_tools' } as never,
        {} as never,
      ),
    ).toMatchObject({ behavior: 'allow' })
    expect(
      await BrowserTool.checkPermissions(
        { url: 'https://example.com', action: 'site_tool_call', toolName: 'cart.checkout' } as never,
        {} as never,
      ),
    ).toMatchObject({ behavior: 'ask' })
  })

  test('validates WebMCP tool names and bounded input', async () => {
    expect(
      await BrowserTool.validateInput?.({
        url: 'https://example.com',
        action: 'site_tool_call',
      } as never),
    ).toMatchObject({ result: false, errorCode: 3 })
    expect(
      await BrowserTool.validateInput?.({
        url: 'https://example.com',
        action: 'site_tool_call',
        toolName: '../unsafe',
      } as never),
    ).toMatchObject({ result: false, errorCode: 4 })
    expect(
      await BrowserTool.validateInput?.({
        url: 'https://example.com',
        action: 'site_tool_call',
        toolName: 'search.catalog',
        toolInput: { query: 'x'.repeat(50_001) },
      } as never),
    ).toMatchObject({ result: false, errorCode: 5 })
  })
})
