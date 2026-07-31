import { afterEach, describe, expect, test } from 'bun:test'
import type { QueuedCommand } from '../src/types/textInputTypes.js'
import {
  enqueue,
  getCommandQueueSnapshot,
  resetCommandQueue,
} from '../src/utils/messageQueueManager.js'
import { processQueueIfReady } from '../src/utils/queueProcessor.js'

function command(value: string): QueuedCommand {
  return { value, mode: 'prompt' }
}

afterEach(() => resetCommandQueue())

describe('queue execution ownership', () => {
  test('distinct prompts are processed as distinct turns', async () => {
    enqueue(command('first'))
    enqueue(command('second'))
    const calls: string[][] = []
    const first = processQueueIfReady({
      executeInput: async commands => {
        calls.push(commands.map(item => String(item.value)))
      },
    })
    await first.completion
    expect(calls).toEqual([['first']])
    expect(getCommandQueueSnapshot().map(item => item.value)).toEqual(['second'])
  })

  test('the caller can observe a rejected execution instead of losing it silently', async () => {
    enqueue(command('fails before model'))
    const result = processQueueIfReady({
      executeInput: async () => {
        throw new Error('dispatch failed')
      },
    })
    expect(result.processed).toBe(true)
    await expect(result.completion).rejects.toThrow('dispatch failed')
  })

  test('an error consumes only its claimed prompt and leaves the next queued', async () => {
    enqueue(command('bad'))
    enqueue(command('still queued'))
    const result = processQueueIfReady({
      executeInput: async () => {
        throw new Error('bad')
      },
    })
    await result.completion?.catch(() => {})
    expect(getCommandQueueSnapshot().map(item => item.value)).toEqual([
      'still queued',
    ])
  })
})
