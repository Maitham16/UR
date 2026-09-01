import { expect, test } from 'bun:test'
import {
  formatOutputTokenLimitMessage,
  SELF_HOSTED_DEFAULT_MAX_OUTPUT_TOKENS,
  usesConservativeOutputReservation,
} from '../src/utils/model/providerRequestTuning.js'

test('user-hosted runtimes use provider-safe output reservations', () => {
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
  expect(usesConservativeOutputReservation('unsloth')).toBe(true)
  expect(usesConservativeOutputReservation('openrouter')).toBe(false)
})

test('output-limit diagnostics identify the provider stop without blaming an accumulator', () => {
  const message = formatOutputTokenLimitMessage('moonshotai/kimi-k3', 32_000)
  expect(message).toContain(
    'provider reported that model "moonshotai/kimi-k3" reached its per-response output boundary',
  )
  expect(message).toContain('32000-token response chunk')
  expect(message).toContain('not a total task-output limit')
  expect(message).toContain('UR_CODE_MAX_OUTPUT_TOKENS')
  expect(message).not.toContain("UR's response exceeded")
})
