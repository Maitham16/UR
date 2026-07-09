import { describe, expect, test } from 'bun:test'
import { ApiTool } from '../src/tools/ApiTool/ApiTool.js'
import { getDefaultAppState } from '../src/state/AppStateStore.js'

function makeContext() {
  return {
    abortController: new AbortController(),
    options: {
      commands: [],
      tools: [],
      mainLoopModel: 'qwen3-coder:480b-cloud',
      thinkingConfig: { type: 'disabled' as const },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: true,
      debug: false,
      verbose: false,
      agentDefinitions: { activeAgents: [], allAgents: [] },
    },
    getAppState: () => getDefaultAppState(),
    setAppState: () => {},
    messages: [],
    readFileState: new Map(),
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
  } as never
}

describe('ApiTool', () => {
  test('GET is read-only, POST is destructive', () => {
    expect(ApiTool.isReadOnly({ url: 'https://example.com', method: 'GET' } as never)).toBe(true)
    expect(ApiTool.isReadOnly({ url: 'https://example.com', method: 'POST' } as never)).toBe(false)
    expect(ApiTool.isDestructive?.({ url: 'https://example.com', method: 'POST' } as never)).toBe(true)
    expect(ApiTool.isDestructive?.({ url: 'https://example.com', method: 'GET' } as never)).toBe(false)
  })

  test('preapproved hosts are allowed for GET', async () => {
    const result = await ApiTool.checkPermissions(
      { url: 'https://docs.ur.dev/something', method: 'GET' } as never,
      makeContext(),
    )
    expect(result.behavior).toBe('allow')
  })

  test('non-preapproved hosts ask permission', async () => {
    const result = await ApiTool.checkPermissions(
      { url: 'https://example.com/api', method: 'GET' } as never,
      makeContext(),
    )
    expect(result.behavior).toBe('ask')
  })

  test('fetches a URL and returns structured output', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ hello: 'world' }), {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch
    try {
      const result = await ApiTool.call(
        { url: 'https://example.com/api', method: 'GET' } as never,
      )
      const data = result.data as { status: number; body: { hello: string } }
      expect(data.status).toBe(200)
      expect(data.body).toEqual({ hello: 'world' })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
