import { describe, expect, test } from 'bun:test'
import {
  PROMPT_TOO_LONG_ERROR_MESSAGE,
  getAssistantMessageFromError,
  isOversizedRequestBodyMessage,
} from '../src/services/api/errors.js'

function errorText(error: unknown): string {
  const message = getAssistantMessageFromError(error, 'test-model')
  const content = message.message.content
  return Array.isArray(content)
    ? content
        .map(block =>
          block.type === 'text' ? block.text : JSON.stringify(block),
        )
        .join(' ')
    : String(content)
}

/**
 * Ollama fronts the model with a Go HTTP server that rejects an oversized body
 * before the model sees it. The message names neither a prompt nor a token
 * count, so it missed the prompt-too-long matcher and none of the recovery ran
 * — the turn died where every other provider would have compacted and retried.
 */
describe('a body rejected for size is treated as a prompt that is too long', () => {
  test("Ollama's Go-level rejection is recognised", () => {
    expect(
      isOversizedRequestBodyMessage(
        'Ollama request failed (400): http: request body too large',
      ),
    ).toBe(true)
  })

  test('proxy and gateway phrasings of the same condition are recognised', () => {
    for (const message of [
      'Request Entity Too Large',
      'HTTP 413: payload too large',
      'upstream rejected: body size limit exceeded',
    ]) {
      expect(isOversizedRequestBodyMessage(message)).toBe(true)
    }
  })

  test('it routes to the prompt-too-long path, so recovery runs', () => {
    const text = errorText(
      new Error('Ollama request failed (400): http: request body too large'),
    )
    expect(text).toContain(PROMPT_TOO_LONG_ERROR_MESSAGE)
  })

  test('the raw error is preserved for the retry loop to inspect', () => {
    const message = getAssistantMessageFromError(
      new Error('Ollama request failed (400): http: request body too large'),
      'test-model',
    )
    expect(message.errorDetails).toContain('request body too large')
  })

  test('an unrelated 400 is not swept into the same path', () => {
    expect(isOversizedRequestBodyMessage('400: invalid model name')).toBe(false)
    expect(errorText(new Error('400: invalid model name'))).not.toContain(
      PROMPT_TOO_LONG_ERROR_MESSAGE,
    )
  })

  test('the existing prompt-too-long phrasing still routes the same way', () => {
    expect(
      errorText(new Error('prompt is too long: 137500 tokens > 135000 maximum')),
    ).toContain(PROMPT_TOO_LONG_ERROR_MESSAGE)
  })
})
