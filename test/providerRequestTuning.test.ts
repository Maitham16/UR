import { describe, expect, test } from 'bun:test'
import type { Message } from '../src/types/message.js'
import {
  getProviderRequestProfile,
  LIGHTWEIGHT_CHAT_MAX_OUTPUT_TOKENS,
  SELF_HOSTED_DEFAULT_MAX_OUTPUT_TOKENS,
  usesConservativeOutputReservation,
} from '../src/utils/model/providerRequestTuning.js'

const user = (content: unknown, isMeta = false): Message => ({
  type: 'user',
  isMeta,
  message: { content },
})

describe('provider request profiles', () => {
  test('a fresh local greeting uses the lightweight profile', () => {
    expect(
      getProviderRequestProfile({
        provider: 'ollama',
        querySource: 'repl_main_thread',
        messages: [user('hi')],
      }),
    ).toMatchObject({
      mode: 'lightweight-chat',
      maxOutputTokens: LIGHTWEIGHT_CHAT_MAX_OUTPUT_TOKENS,
    })
  })

  test('synthetic context does not hide a fresh greeting', () => {
    expect(
      getProviderRequestProfile({
        provider: 'vllm',
        querySource: 'repl_main_thread',
        messages: [user('<environment>large context</environment>', true), user('hello!')],
      }).mode,
    ).toBe('lightweight-chat')
  })

  test('non-interactive SDK print mode gets the same safe fast path', () => {
    expect(
      getProviderRequestProfile({
        provider: 'ollama',
        querySource: 'sdk',
        messages: [user('<environment>context</environment>', true), user('hi')],
      }).mode,
    ).toBe('lightweight-chat')
  })

  test('coding, media, and ongoing conversations retain the full agent', () => {
    const requests: Message[][] = [
      [user('fix the bug in src/app.ts')],
      [user([{ type: 'text', text: 'hi' }, { type: 'image', source: {} }])],
      [
        user('hi'),
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } },
        user('thanks'),
      ],
    ]

    for (const messages of requests) {
      expect(
        getProviderRequestProfile({
          provider: 'ollama',
          querySource: 'repl_main_thread',
          messages,
        }).mode,
      ).toBe('agent')
    }
  })

  test('every runnable provider avoids a full agent prompt for a greeting', () => {
    for (const provider of [
      'openrouter',
      'openai-api',
      'anthropic-api',
      'gemini-api',
      'codex-cli',
      'claude-code-cli',
      'gemini-cli',
    ] as const) {
      expect(
        getProviderRequestProfile({
          provider,
          querySource: 'repl_main_thread',
          messages: [user('hi')],
        }).mode,
      ).toBe('lightweight-chat')
    }
  })
})

test('user-hosted runtimes use conservative output reservations', () => {
  expect(SELF_HOSTED_DEFAULT_MAX_OUTPUT_TOKENS).toBe(4_096)
  for (const provider of [
    'ollama',
    'vllm',
    'lmstudio',
    'llama.cpp',
    'openai-compatible',
  ] as const) {
    expect(usesConservativeOutputReservation(provider)).toBe(true)
  }
  expect(usesConservativeOutputReservation('openrouter')).toBe(false)
})
