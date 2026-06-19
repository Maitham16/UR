import { expect, test } from 'bun:test'
import {
  categorizeOllamaModels,
  classifyTaskComplexity,
  isOllamaAutoRouteEnabled,
  parseModelParamsB,
  pickBestCoderModel,
  pickSmallFastModel,
  recommendedCoderModelToPull,
  selectOllamaModelForPrompt,
} from '../src/utils/model/ollamaRouter.js'

test('parseModelParamsB reads parameter counts from model names', () => {
  expect(parseModelParamsB('qwen2.5-coder:7b')).toBe(7)
  expect(parseModelParamsB('llama3.2:3b')).toBe(3)
  expect(parseModelParamsB('mixtral:8x7b')).toBe(7)
  expect(parseModelParamsB('deepseek-coder-v2:16b')).toBe(16)
  expect(parseModelParamsB('llama3.1:70b')).toBe(70)
  expect(parseModelParamsB('phi3:mini')).toBeUndefined()
  expect(parseModelParamsB('mistral:latest')).toBeUndefined()
})

test('categorize detects coder and fast tiers without false positives', () => {
  const tiers = categorizeOllamaModels([
    'qwen2.5-coder:7b',
    'llama3.2:3b',
    'llama3.1:70b',
    'phi3:mini',
    'dolphin-mixtral:8x7b',
  ])
  expect(tiers.coder).toContain('qwen2.5-coder:7b')
  expect(tiers.coder).not.toContain('llama3.1:70b')
  expect(tiers.fast).toContain('llama3.2:3b')
  expect(tiers.fast).toContain('phi3:mini')
  // "phi" inside "dolphin" must not be treated as fast
  expect(tiers.fast).not.toContain('dolphin-mixtral:8x7b')
})

test('pickBestCoderModel prefers the largest coder, else the largest model', () => {
  expect(
    pickBestCoderModel([
      'qwen2.5-coder:7b',
      'deepseek-coder-v2:16b',
      'llama3.1:70b',
    ]),
  ).toBe('deepseek-coder-v2:16b')
  expect(pickBestCoderModel(['llama3.1:70b', 'llama3.2:3b'])).toBe(
    'llama3.1:70b',
  )
  expect(pickBestCoderModel([], 'fallback')).toBe('fallback')
})

test('pickSmallFastModel prefers the smallest fast model', () => {
  expect(
    pickSmallFastModel(['qwen2.5-coder:7b', 'llama3.2:3b', 'phi3:mini']),
  ).toBe('llama3.2:3b')
  expect(pickSmallFastModel(['qwen2.5-coder:32b', 'llama3.1:70b'])).toBe(
    'qwen2.5-coder:32b',
  )
  expect(pickSmallFastModel([], 'fallback')).toBe('fallback')
})

test('classifyTaskComplexity distinguishes chat from coding work', () => {
  expect(classifyTaskComplexity('hi')).toBe('simple')
  expect(classifyTaskComplexity('what is a closure')).toBe('simple')
  expect(classifyTaskComplexity('fix the bug in foo.ts')).toBe('complex')
  expect(classifyTaskComplexity('refactor the auth module')).toBe('complex')
  expect(classifyTaskComplexity('x'.repeat(300))).toBe('complex')
})

test('selectOllamaModelForPrompt routes by task complexity', () => {
  const names = ['qwen2.5-coder:7b', 'llama3.2:3b']
  expect(
    selectOllamaModelForPrompt({ prompt: 'hi', names, defaultModel: 'd' }),
  ).toBe('llama3.2:3b')
  expect(
    selectOllamaModelForPrompt({
      prompt: 'fix the bug in a.ts',
      names,
      defaultModel: 'd',
    }),
  ).toBe('qwen2.5-coder:7b')
  expect(
    selectOllamaModelForPrompt({
      prompt: 'fix the bug in a.ts',
      names,
      defaultModel: 'd',
      enabled: false,
    }),
  ).toBe('d')
  expect(
    selectOllamaModelForPrompt({ prompt: 'anything', names: [], defaultModel: 'd' }),
  ).toBe('d')
})

test('recommends pulling a coder model only when none is installed', () => {
  expect(recommendedCoderModelToPull(['llama3.1:70b', 'phi3:mini'])).toBe(
    'qwen2.5-coder',
  )
  expect(
    recommendedCoderModelToPull(['qwen2.5-coder:7b', 'llama3.2:3b']),
  ).toBeUndefined()
})

test('auto-route is on by default and respects the off switch', () => {
  expect(isOllamaAutoRouteEnabled({})).toBe(true)
  expect(isOllamaAutoRouteEnabled({ UR_OLLAMA_AUTO_ROUTE: '1' })).toBe(true)
  expect(isOllamaAutoRouteEnabled({ UR_OLLAMA_AUTO_ROUTE: 'off' })).toBe(false)
  expect(isOllamaAutoRouteEnabled({ UR_OLLAMA_AUTO_ROUTE: 'false' })).toBe(false)
})
