import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import type { Tool, ToolResult } from '../src/Tool.js'
import {
  describeMcpTool,
  formatMcpToolResult,
  parseMcpToolArguments,
} from '../src/entrypoints/mcpToolAdapter.js'
import {
  RollingRateLimitError,
  RollingRateLimiter,
  readPositiveInteger,
} from '../src/utils/rollingRateLimiter.js'

function fakeTool(overrides: Partial<Tool> = {}): Tool {
  return {
    name: 'demo',
    inputSchema: z.object({ count: z.coerce.number().int().positive() }),
    outputSchema: z.object({ doubled: z.number() }),
    prompt: async () => 'Double a positive number',
    call: async () => ({ data: { doubled: 2 } }),
    description: async () => 'demo',
    isConcurrencySafe: () => true,
    isEnabled: () => true,
    isReadOnly: () => true,
    isOpenWorld: () => false,
    checkPermissions: async () => ({ behavior: 'allow' }),
    maxResultSizeChars: 10_000,
    ...overrides,
  } as Tool
}

describe('MCP tool adapter', () => {
  test('validates and applies schema transformations to every tool input', async () => {
    const parsed = await parseMcpToolArguments(fakeTool(), { count: '3' })
    expect(parsed).toEqual({ count: 3 })

    await expect(
      parseMcpToolArguments(fakeTool(), { count: 0 }),
    ).rejects.toThrow('count:')
    await expect(
      parseMcpToolArguments(fakeTool(), { count: '123' }, 5),
    ).rejects.toThrow('exceeding the MCP input limit')
  })

  test('publishes only protocol fields, not internal tool implementation data', async () => {
    const descriptor = await describeMcpTool(
      fakeTool({ searchHint: 'internal search hint', shouldDefer: true }),
      [],
      {} as never,
    )

    expect(descriptor.name).toBe('demo')
    expect(descriptor.description).toBe('Double a positive number')
    expect(descriptor.inputSchema.type).toBe('object')
    expect(descriptor.outputSchema?.type).toBe('object')
    expect(descriptor).not.toHaveProperty('searchHint')
    expect(descriptor).not.toHaveProperty('call')
  })

  test('validates and forwards structured output and MCP metadata', async () => {
    const result = await formatMcpToolResult(
      fakeTool(),
      {
        data: { doubled: 6 },
        mcpMeta: { _meta: { requestId: 'req-1' } },
      } as ToolResult<unknown>,
      1_000,
    )

    expect(result.structuredContent).toEqual({ doubled: 6 })
    expect(result._meta).toEqual({ requestId: 'req-1' })
    expect(result.content[0]).toEqual({
      type: 'text',
      text: '{"doubled":6}',
    })
  })

  test('turns oversized results into actionable tool errors', async () => {
    const result = await formatMcpToolResult(
      fakeTool({ outputSchema: undefined }),
      { data: '123456' },
      5,
    )

    expect(result.isError).toBe(true)
    expect(result.content[0]).toHaveProperty('text')
    expect((result.content[0] as { text: string }).text).toContain(
      'exceeding the MCP output limit',
    )
  })

  test('includes structured content and metadata in the output limit', async () => {
    const result = await formatMcpToolResult(
      fakeTool({ outputSchema: undefined }),
      {
        data: 'ok',
        mcpMeta: {
          structuredContent: { payload: '123456' },
          _meta: { trace: 'abcdef' },
        },
      },
      10,
    )

    expect(result.isError).toBe(true)
  })
})

describe('MCP rate limiter', () => {
  test('enforces concurrent and rolling-window limits and releases idempotently', () => {
    const limiter = new RollingRateLimiter({
      maxCalls: 2,
      windowMs: 1_000,
      maxConcurrent: 1,
    })
    const release = limiter.acquire(1_000)
    expect(() => limiter.acquire(1_001)).toThrow(RollingRateLimitError)
    release()
    release()
    const releaseSecond = limiter.acquire(1_002)
    releaseSecond()
    expect(() => limiter.acquire(1_003)).toThrow(RollingRateLimitError)

    const releaseAfterWindow = limiter.acquire(2_001)
    releaseAfterWindow()
  })

  test('bounds environment-provided limits', () => {
    expect(readPositiveInteger(undefined, 8, 100)).toBe(8)
    expect(readPositiveInteger('invalid', 8, 100)).toBe(8)
    expect(readPositiveInteger('0', 8, 100)).toBe(8)
    expect(readPositiveInteger('1000', 8, 100)).toBe(100)
  })
})
