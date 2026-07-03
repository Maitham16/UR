import { describe, expect, test } from 'bun:test'
import { deriveMultimodalSupport } from './providerKnowledge.js'

describe('deriveMultimodalSupport', () => {
  test('ur-native cloud APIs are curated as multimodal-capable', () => {
    expect(deriveMultimodalSupport('openai-api')).toBe(true)
    expect(deriveMultimodalSupport('anthropic-api')).toBe(true)
    expect(deriveMultimodalSupport('gemini-api')).toBe(true)
    expect(deriveMultimodalSupport('openrouter')).toBe(true)
  })

  test('subscription CLI providers are curated as not multimodal-capable through UR', () => {
    expect(deriveMultimodalSupport('codex-cli')).toBe(false)
    expect(deriveMultimodalSupport('claude-code-cli')).toBe(false)
    expect(deriveMultimodalSupport('gemini-cli')).toBe(false)
    expect(deriveMultimodalSupport('antigravity-cli')).toBe(false)
  })

  test('local/self-hosted and unrecognized providers render as unknown, never guessed', () => {
    expect(deriveMultimodalSupport('ollama')).toBe('unknown')
    expect(deriveMultimodalSupport('lmstudio')).toBe('unknown')
    expect(deriveMultimodalSupport('llama.cpp')).toBe('unknown')
    expect(deriveMultimodalSupport('vllm')).toBe('unknown')
    expect(deriveMultimodalSupport('openai-compatible')).toBe('unknown')
    expect(deriveMultimodalSupport('some-future-provider')).toBe('unknown')
  })
})
