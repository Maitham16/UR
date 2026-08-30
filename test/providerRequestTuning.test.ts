import { expect, test } from 'bun:test'
import {
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
  expect(usesConservativeOutputReservation('openrouter')).toBe(false)
})
