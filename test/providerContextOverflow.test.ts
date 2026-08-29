import { APIError } from '@urhq-ai/sdk'
import { describe, expect, test } from 'bun:test'
import {
  parseMaxTokensContextOverflowError,
  withRetry,
} from '../src/services/api/withRetry.js'

function apiError(message: string): APIError {
  return new APIError(
    400,
    { error: { type: 'BadRequestError', message } },
    message,
    new Headers(),
  )
}

describe('context overflow parsing', () => {
  test('parses URHQ arithmetic errors', () => {
    expect(
      parseMaxTokensContextOverflowError(
        apiError(
          'input length and `max_tokens` exceed context limit: 188059 + 20000 > 200000',
        ),
      ),
    ).toEqual({
      inputTokens: 188_059,
      maxTokens: 20_000,
      contextLimit: 200_000,
    })
  })

  test('parses vLLM OpenAI-compatible errors with wrapped JSON text', () => {
    const message = `OpenAI-compatible streaming request failed (400): {"error":{"message":"This
model's maximum context length is 50,000 tokens. However, you requested
32,000 output tokens and your prompt contains at least 18,001 input tokens,
for a total of at least 50,001 tokens."}}`
    expect(parseMaxTokensContextOverflowError(apiError(message))).toEqual({
      inputTokens: 18_001,
      maxTokens: 32_000,
      contextLimit: 50_000,
    })
  })

  test('ignores unrelated 400 responses', () => {
    expect(
      parseMaxTokensContextOverflowError(apiError('invalid tool schema')),
    ).toBeUndefined()
  })
})

test('vLLM overflow retries once with an output budget that fits', async () => {
  const seenOverrides: Array<number | undefined> = []
  const overflow = apiError(
    "This model's maximum context length is 50000 tokens. However, you requested 32000 output tokens and your prompt contains at least 18001 input tokens, for a total of at least 50001 tokens.",
  )
  const retry = withRetry(
    async () => ({}) as never,
    async (_client, attempt, context) => {
      seenOverrides.push(context.maxTokensOverride)
      if (attempt === 1) throw overflow
      return 'ok'
    },
    {
      maxRetries: 1,
      model: 'local-vllm-model',
      thinkingConfig: { type: 'disabled' },
      querySource: 'repl_main_thread',
    },
  )

  let result: string | undefined
  while (true) {
    const step = await retry.next()
    if (step.done) {
      result = step.value
      break
    }
  }

  expect(result).toBe('ok')
  expect(seenOverrides).toEqual([undefined, 30_999])
})
