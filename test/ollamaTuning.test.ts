import { expect, test } from 'bun:test'
import {
  computeOllamaNumCtx,
  getOllamaKeepAlive,
  getOllamaNumCtxOverride,
  MIN_AGENT_NUM_CTX,
} from '../src/utils/model/ollamaTuning.js'

test('num_ctx floors at the agent minimum for small prompts', () => {
  expect(computeOllamaNumCtx({})).toBe(MIN_AGENT_NUM_CTX)
})

test('num_ctx never exceeds the model context window', () => {
  expect(computeOllamaNumCtx({ modelContextLength: 8192 })).toBe(8192)
})

test('num_ctx grows in coarse buckets as the prompt grows', () => {
  expect(
    computeOllamaNumCtx({ estimatedPromptTokens: 60000, maxTokens: 4096 }),
  ).toBe(65536)
})

test('num_ctx caps a large prompt to the model window', () => {
  expect(
    computeOllamaNumCtx({
      estimatedPromptTokens: 60000,
      modelContextLength: 40960,
    }),
  ).toBe(40960)
})

test('num_ctx override wins even when detected model window is smaller', () => {
  expect(computeOllamaNumCtx({ override: 16000 })).toBe(16000)
  expect(
    computeOllamaNumCtx({ override: 16000, modelContextLength: 8192 }),
  ).toBe(16000)
})

test('num_ctx override of zero disables the setting', () => {
  expect(computeOllamaNumCtx({ override: 0 })).toBeUndefined()
})

test('num_ctx override env parsing', () => {
  expect(getOllamaNumCtxOverride({})).toBeUndefined()
  expect(getOllamaNumCtxOverride({ UR_OLLAMA_NUM_CTX: '16000' })).toBe(16000)
  expect(getOllamaNumCtxOverride({ UR_OLLAMA_NUM_CTX: '0' })).toBe(0)
  expect(getOllamaNumCtxOverride({ UR_OLLAMA_NUM_CTX: 'nope' })).toBeUndefined()
})

test('keep_alive defaults to 30m and honors overrides', () => {
  expect(getOllamaKeepAlive({})).toBe('30m')
  expect(getOllamaKeepAlive({ UR_OLLAMA_KEEP_ALIVE: '1h' })).toBe('1h')
  expect(getOllamaKeepAlive({ UR_OLLAMA_KEEP_ALIVE: '600' })).toBe(600)
  expect(getOllamaKeepAlive({ UR_OLLAMA_KEEP_ALIVE: '0' })).toBe(0)
  expect(getOllamaKeepAlive({ UR_OLLAMA_KEEP_ALIVE: '-1' })).toBe(-1)
})
