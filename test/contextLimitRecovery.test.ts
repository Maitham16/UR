import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  prepareContextLimitCompaction,
  shouldAttemptAutomaticContextRecovery,
} from '../src/services/compact/autoCompact.js'
import { createUserMessage } from '../src/utils/messages.js'

describe('shipped context-limit recovery policy', () => {
  test('runs once for normal work when automatic compaction is enabled', () => {
    expect(
      shouldAttemptAutomaticContextRecovery({
        autoCompactEnabled: true,
        querySource: 'repl_main_thread',
        hasAttempted: false,
        nativeRecoveryAvailable: false,
      }),
    ).toBe(true)

    for (const disabled of [
      { autoCompactEnabled: false },
      { hasAttempted: true },
      { nativeRecoveryAvailable: true },
      { querySource: 'compact' as const },
      { querySource: 'session_memory' as const },
    ]) {
      expect(
        shouldAttemptAutomaticContextRecovery({
          autoCompactEnabled: true,
          querySource: 'repl_main_thread',
          hasAttempted: false,
          nativeRecoveryAvailable: false,
          ...disabled,
        }),
      ).toBe(false)
    }
  })

  test('strips a screenshot only from emergency summary inputs', () => {
    const original = createUserMessage({
      content: [
        { type: 'text', text: 'screen result' },
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'abc' },
        },
      ],
    })
    const cacheSafeParams = {
      systemPrompt: [] as never,
      userContext: {},
      systemContext: {},
      toolUseContext: {} as never,
      forkContextMessages: [original],
    }

    const prepared = prepareContextLimitCompaction(
      [original],
      cacheSafeParams,
    )
    expect(JSON.stringify(prepared.messages)).not.toContain('"data":"abc"')
    expect(JSON.stringify(prepared.cacheSafeParams.forkContextMessages)).not.toContain(
      '"data":"abc"',
    )
    expect(JSON.stringify(prepared.messages)).toContain('[image]')
    expect(JSON.stringify(original)).toContain('"data":"abc"')
  })

  test('the query loop withholds, compacts, and retries the transient error', () => {
    const source = readFileSync(join(import.meta.dir, '../src/query.ts'), 'utf8')
    expect(source).toContain(
      'universalContextRecoveryEnabled &&\n              isPromptTooLongMessage(message)',
    )
    expect(source).toContain("'context_limit',")
    expect(source).toContain("transition: { reason: 'reactive_compact_retry' }")
  })
})
