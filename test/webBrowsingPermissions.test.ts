import { expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../src/Tool.ts'
import { WebFetchTool } from '../src/tools/WebFetchTool/WebFetchTool.ts'
import { WebSearchTool } from '../src/tools/WebSearchTool/WebSearchTool.ts'

function contextWithRules(rules: {
  allow?: string[]
  deny?: string[]
  ask?: string[]
} = {}) {
  return {
    getAppState: () => ({
      toolPermissionContext: {
        ...getEmptyToolPermissionContext(),
        alwaysAllowRules: rules.allow ? { localSettings: rules.allow } : {},
        alwaysDenyRules: rules.deny ? { localSettings: rules.deny } : {},
        alwaysAskRules: rules.ask ? { localSettings: rules.ask } : {},
      },
    }),
  } as any
}

test('WebFetch allows read-only browsing by default', async () => {
  const result = await WebFetchTool.checkPermissions(
    {
      url: 'https://example.com/docs',
      prompt: 'Summarize the page',
    },
    contextWithRules(),
  )

  expect(result.behavior).toBe('allow')
})

test('WebFetch still respects explicit domain deny and ask rules', async () => {
  const denied = await WebFetchTool.checkPermissions(
    {
      url: 'https://example.com/docs',
      prompt: 'Summarize the page',
    },
    contextWithRules({ deny: ['WebFetch(domain:example.com)'] }),
  )
  expect(denied.behavior).toBe('deny')

  const asked = await WebFetchTool.checkPermissions(
    {
      url: 'https://example.com/docs',
      prompt: 'Summarize the page',
    },
    contextWithRules({ ask: ['WebFetch(domain:example.com)'] }),
  )
  expect(asked.behavior).toBe('ask')
})

test('WebFetch includes the fetched URL in model-visible tool results', () => {
  const block = WebFetchTool.mapToolResultToToolResultBlockParam(
    {
      bytes: 42,
      code: 200,
      codeText: 'OK',
      durationMs: 10,
      result: 'Page summary',
      url: 'https://example.com/docs',
    },
    'toolu_1',
  )

  expect(block.content).toContain('Source URL: https://example.com/docs')
  expect(block.content).toContain('Page summary')
})

test('WebSearch allows read-only searches by default', async () => {
  const result = await WebSearchTool.checkPermissions(
    {
      query: 'latest TypeScript release',
    },
    contextWithRules(),
  )

  expect(result.behavior).toBe('allow')
})

test('WebSearch still respects explicit query deny and ask rules', async () => {
  const denied = await WebSearchTool.checkPermissions(
    {
      query: 'latest TypeScript release',
    },
    contextWithRules({ deny: ['WebSearch(latest TypeScript release)'] }),
  )
  expect(denied.behavior).toBe('deny')

  const asked = await WebSearchTool.checkPermissions(
    {
      query: 'latest TypeScript release',
    },
    contextWithRules({ ask: ['WebSearch(latest TypeScript release)'] }),
  )
  expect(asked.behavior).toBe('ask')
})
