import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import { StreamingToolExecutor } from '../src/services/tools/StreamingToolExecutor.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return await Promise.race([
    promise,
    Bun.sleep(1_000).then(() => {
      throw new Error('Timed out waiting for streaming tool executor')
    }),
  ])
}

describe('StreamingToolExecutor discard', () => {
  test('aborts in-flight tools, skips queued tools, and settles bookkeeping', async () => {
    const firstStarted = deferred()
    const startedToolIDs: string[] = []
    let runningSignal: AbortSignal | undefined

    const runToolUse = async function* (
      block: { id: string },
      _assistantMessage: unknown,
      _canUseTool: unknown,
      context: { abortController: AbortController },
    ): AsyncGenerator<never, void> {
      startedToolIDs.push(block.id)
      if (block.id === 'first') {
        runningSignal = context.abortController.signal
        firstStarted.resolve()
      }

      await new Promise<void>(resolve => {
        if (context.abortController.signal.aborted) {
          resolve()
          return
        }
        context.abortController.signal.addEventListener('abort', () => resolve(), {
          once: true,
        })
      })
    }

    const tool = {
      name: 'LongRunning',
      inputSchema: z.object({}),
      isConcurrencySafe: () => false,
      interruptBehavior: () => 'cancel' as const,
    }

    let inProgressToolUseIDs = new Set<string>()
    const interruptibleStates: boolean[] = []
    const queryAbortController = new AbortController()
    const context = {
      abortController: queryAbortController,
      setInProgressToolUseIDs: (
        update: (previous: Set<string>) => Set<string>,
      ) => {
        inProgressToolUseIDs = update(inProgressToolUseIDs)
      },
      setHasInterruptibleToolInProgress: (value: boolean) => {
        interruptibleStates.push(value)
      },
    }

    const executor = new StreamingToolExecutor(
      [tool] as never,
      (() => {
        throw new Error('Permission callback should not be used by this test')
      }) as never,
      context as never,
      runToolUse as never,
    )

    executor.addTool(
      {
        type: 'tool_use',
        id: 'first',
        name: tool.name,
        input: {},
      },
      { uuid: 'assistant-message' } as never,
    )
    await withTimeout(firstStarted.promise)

    executor.addTool(
      {
        type: 'tool_use',
        id: 'queued',
        name: tool.name,
        input: {},
      },
      { uuid: 'assistant-message' } as never,
    )

    expect(inProgressToolUseIDs).toEqual(new Set(['first']))
    expect(interruptibleStates).toContain(true)

    const results = executor.getRemainingResults()
    const pendingResult = results.next()
    executor.discard()

    expect(runningSignal?.aborted).toBe(true)
    expect(runningSignal?.reason).toBe('streaming_fallback')
    expect(queryAbortController.signal.aborted).toBe(false)
    expect(inProgressToolUseIDs.size).toBe(0)
    expect(interruptibleStates.at(-1)).toBe(false)
    expect(await withTimeout(pendingResult)).toEqual({
      done: true,
      value: undefined,
    })

    await Bun.sleep(0)
    expect(startedToolIDs).toEqual(['first'])
    expect(inProgressToolUseIDs.size).toBe(0)
  })

  test('normalizes a fractional concurrency limit to an integer', async () => {
    const previous = process.env.UR_MAX_CONCURRENT_TOOLS
    process.env.UR_MAX_CONCURRENT_TOOLS = '1.5'
    const release = deferred()
    const started: string[] = []
    try {
      const runToolUse = async function* (
        block: { id: string },
      ): AsyncGenerator<never, void> {
        started.push(block.id)
        await release.promise
      }
      const tool = {
        name: 'ConcurrentRead',
        inputSchema: z.object({}),
        isConcurrencySafe: () => true,
      }
      const context = {
        abortController: new AbortController(),
        setInProgressToolUseIDs: () => {},
      }
      const executor = new StreamingToolExecutor(
        [tool] as never,
        (() => {}) as never,
        context as never,
        runToolUse as never,
      )

      for (const id of ['first', 'second']) {
        executor.addTool(
          { type: 'tool_use', id, name: tool.name, input: {} },
          { uuid: 'assistant-message' } as never,
        )
      }
      await Bun.sleep(0)
      expect(started).toEqual(['first'])

      release.resolve()
      await Array.fromAsync(executor.getRemainingResults())
      expect(started).toEqual(['first', 'second'])
    } finally {
      if (previous === undefined) {
        delete process.env.UR_MAX_CONCURRENT_TOOLS
      } else {
        process.env.UR_MAX_CONCURRENT_TOOLS = previous
      }
    }
  })
})
