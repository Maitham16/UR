import { describe, expect, test } from 'bun:test'
import { isPromptTooLongMessage, PROMPT_TOO_LONG_ERROR_MESSAGE } from '../src/services/api/errors.js'
import { getResponseBoundaryError } from '../src/services/api/ur.js'
import { normalizeOpenAIChatUsage } from '../src/services/api/usageNormalization.js'
import { createAssistantAPIErrorMessage } from '../src/utils/messages.js'

const usage = {
  input_tokens: 100,
  cache_creation_input_tokens: 200,
  cache_read_input_tokens: 300,
  output_tokens: 4096,
}

describe('provider response-boundary errors', () => {
  test('output exhaustion carries the actual response budget and complete input usage', () => {
    const error = getResponseBoundaryError({
      stopReason: 'max_tokens', model: 'provider-model', requestedMaxTokens: 4096, usage,
    })!
    expect(error).toMatchObject({
      isApiErrorMessage: true, apiError: 'max_output_tokens', error: 'max_output_tokens',
      outputLimit: { requestedMaxTokens: 4096, inputTokens: 600, outputTokens: 4096 },
    })
    expect(isPromptTooLongMessage(error)).toBe(false)
    expect(JSON.parse(JSON.stringify(error)).outputLimit).toEqual(error.outputLimit)
  })

  test('normalized OpenAI cached input is included exactly once', () => {
    const error = getResponseBoundaryError({
      stopReason: 'max_tokens', model: 'provider-model', requestedMaxTokens: 8192,
      usage: normalizeOpenAIChatUsage({
        prompt_tokens: 1000, prompt_tokens_details: { cached_tokens: 800 }, completion_tokens: 8192,
      }) as typeof usage,
    })!
    expect(error.outputLimit).toEqual({ requestedMaxTokens: 8192, inputTokens: 1000, outputTokens: 8192 })
  })

  test('context exhaustion selects prompt-too-long recovery instead of output continuation', () => {
    const error = getResponseBoundaryError({
      stopReason: 'model_context_window_exceeded', model: 'provider-model', requestedMaxTokens: 4096, usage,
    })!
    expect(error).toMatchObject({
      isApiErrorMessage: true, apiError: 'prompt_too_long', error: 'invalid_request',
      message: { content: [{ type: 'text', text: PROMPT_TOO_LONG_ERROR_MESSAGE }] },
    })
    expect(isPromptTooLongMessage(error)).toBe(true)
    expect(error.errorDetails).toContain('model_context_window_exceeded')
    expect(error.outputLimit).toBeUndefined()
  })

  test('completed, tool, refusal and absent stops do not manufacture boundary errors', () => {
    for (const stopReason of ['end_turn', 'tool_use', 'stop_sequence', 'refusal', null]) {
      expect(getResponseBoundaryError({ stopReason, model: 'provider-model', requestedMaxTokens: 4096, usage })).toBeUndefined()
    }
  })

  test('ordinary API errors retain their existing shape without output metadata', () => {
    const error = createAssistantAPIErrorMessage({ content: 'Fixture provider error', error: 'invalid_request' })
    expect(Object.hasOwn(error, 'outputLimit')).toBe(false)
  })
})
