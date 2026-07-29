import { afterEach, describe, expect, test } from 'bun:test'
import {
  getMaxToolUseConcurrency,
  runTools,
} from '../src/services/tools/toolOrchestration.js'

const originalConcurrency = process.env.UR_CODE_MAX_TOOL_USE_CONCURRENCY

afterEach(() => {
  if (originalConcurrency === undefined) {
    delete process.env.UR_CODE_MAX_TOOL_USE_CONCURRENCY
  } else {
    process.env.UR_CODE_MAX_TOOL_USE_CONCURRENCY = originalConcurrency
  }
})

describe('tool orchestration hardening', () => {
  test('normalizes invalid concurrency and caps excessive values', () => {
    process.env.UR_CODE_MAX_TOOL_USE_CONCURRENCY = '-1'
    expect(getMaxToolUseConcurrency()).toBe(10)

    process.env.UR_CODE_MAX_TOOL_USE_CONCURRENCY = '0'
    expect(getMaxToolUseConcurrency()).toBe(10)

    process.env.UR_CODE_MAX_TOOL_USE_CONCURRENCY = '999'
    expect(getMaxToolUseConcurrency()).toBe(32)

    process.env.UR_CODE_MAX_TOOL_USE_CONCURRENCY = '4'
    expect(getMaxToolUseConcurrency()).toBe(4)
  })

  test('clears in-progress bookkeeping when a consumer stops early', async () => {
    const block = {
      type: 'tool_use',
      id: 'unknown-tool-use',
      name: 'ToolThatDoesNotExist',
      input: {},
    } as const
    let inProgress = new Set<string>()
    const context = {
      options: {
        tools: [],
        mcpClients: [],
      },
      setInProgressToolUseIDs: (
        update: (previous: Set<string>) => Set<string>,
      ) => {
        inProgress = update(inProgress)
      },
    }
    const assistantMessage = {
      type: 'assistant',
      uuid: 'assistant-uuid',
      message: {
        id: 'assistant-message',
        content: [block],
      },
    }

    const results = runTools(
      [block] as never,
      [assistantMessage] as never,
      (() => {}) as never,
      context as never,
    )
    expect((await results.next()).done).toBe(false)
    expect(inProgress).toEqual(new Set(['unknown-tool-use']))

    await results.return()
    expect(inProgress.size).toBe(0)
  })

  test('clears every concurrent batch member when multiplexed iteration is cancelled', async () => {
    const blocks = ['first', 'second'].map(id => ({
      type: 'tool_use' as const,
      id,
      name: 'ConcurrentRead',
      input: {},
    }))
    const tool = {
      name: 'ConcurrentRead',
      inputSchema: {
        safeParse: () => ({ success: true, data: {} }),
      },
      isConcurrencySafe: () => true,
    }
    let inProgress = new Set<string>()
    const abortController = new AbortController()
    abortController.abort('test-cancel')
    const context = {
      abortController,
      options: {
        tools: [tool],
        mcpClients: [],
      },
      setInProgressToolUseIDs: (
        update: (previous: Set<string>) => Set<string>,
      ) => {
        inProgress = update(inProgress)
      },
    }
    const assistantMessage = {
      type: 'assistant',
      uuid: 'assistant-uuid',
      message: {
        id: 'assistant-message',
        content: blocks,
      },
    }

    const results = runTools(
      blocks as never,
      [assistantMessage] as never,
      (() => {}) as never,
      context as never,
    )
    expect((await results.next()).done).toBe(false)
    // all() resumes the generator that won Promise.race before yielding, so
    // that winner may already have completed; its still-paused sibling has not.
    expect(inProgress.size).toBeGreaterThan(0)

    await results.return()
    expect(inProgress.size).toBe(0)
  })

  test('rejects duplicate IDs before starting any tool', async () => {
    const blocks = ['first', 'second'].map(() => ({
      type: 'tool_use' as const,
      id: 'duplicate-id',
      name: 'MutatingTool',
      input: {},
    }))
    let inProgress = new Set<string>()
    const context = {
      options: { tools: [], mcpClients: [] },
      setInProgressToolUseIDs(
        update: (previous: Set<string>) => Set<string>,
      ) {
        inProgress = update(inProgress)
      },
    }
    const assistantMessage = {
      type: 'assistant',
      uuid: 'assistant-duplicate',
      message: { id: 'assistant-duplicate', content: blocks },
    }

    const results = runTools(
      blocks as never,
      [assistantMessage] as never,
      (() => {}) as never,
      context as never,
    )
    await expect(results.next()).rejects.toThrow('Duplicate tool_use id')
    expect(inProgress.size).toBe(0)
  })

  test('rejects missing assistant correlation before execution', async () => {
    const block = {
      type: 'tool_use' as const,
      id: 'orphan-id',
      name: 'MutatingTool',
      input: {},
    }
    const context = {
      options: { tools: [], mcpClients: [] },
      setInProgressToolUseIDs() {
        throw new Error('must not start')
      },
    }
    const results = runTools(
      [block] as never,
      [] as never,
      (() => {}) as never,
      context as never,
    )
    await expect(results.next()).rejects.toThrow(
      'Expected exactly one assistant message',
    )
  })
})
