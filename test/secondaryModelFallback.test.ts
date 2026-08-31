import { afterEach, beforeEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resetStateForTests } from '../src/bootstrap/state.ts'
import { __resetOllamaRouteMemoForTests } from '../src/utils/model/model.ts'
import {
  resetSettingsCache,
  setSessionSettingsCache,
} from '../src/utils/settings/settingsCache.ts'

// A live run exposed this: WebFetch fetched example.com fine (559 bytes, 200
// OK), then summarising it failed with "Model qwen2.5-coder:7b is not
// available for provider ollama" — a model the user never had. The error text
// was returned as the fetch result, so the evidence ledger recorded an API
// error as the content of example.com and --check against real page text
// correctly found nothing. Two separate defects in one line of output.

const modelEnvKeys = [
  'OLLAMA_MODEL',
  'OLLAMA_SMALL_FAST_MODEL',
  'URHQ_MODEL',
  'URHQ_SMALL_FAST_MODEL',
  'UR_MODEL',
] as const
const originalModelEnv = Object.fromEntries(
  modelEnvKeys.map(key => [key, process.env[key]]),
) as Record<(typeof modelEnvKeys)[number], string | undefined>

function restoreOriginalModelEnvironment(): void {
  for (const key of modelEnvKeys) {
    const original = originalModelEnv[key]
    if (original === undefined) delete process.env[key]
    else process.env[key] = original
  }
}

function resetModelSelectionState(): void {
  resetStateForTests()
  resetSettingsCache()
  __resetOllamaRouteMemoForTests()
}

beforeEach(() => {
  resetModelSelectionState()
  for (const key of modelEnvKeys) delete process.env[key]

  // Prime the session cache with a controlled snapshot. A plain cache clear is
  // insufficient here: the next model lookup would immediately reload the
  // developer's real user/project settings (including provider.model).
  setSessionSettingsCache({
    settings: { provider: { active: 'ollama' } },
    errors: [],
  })
})

afterEach(() => {
  restoreOriginalModelEnvironment()
  resetModelSelectionState()
})

test('the small-fast fallback uses the session model, not a compiled default', async () => {
  // getDefaultOllamaModel() returns qwen2.5-coder:7b when routing is off or no
  // model list has been discovered. Falling back to a model the user may not
  // have pulled guarantees every secondary query fails.
  process.env.OLLAMA_MODEL = 'kimi-k2.7-code:cloud'
  const { getSmallFastModel, getMainLoopModel } = await import(
    '../src/utils/model/model.ts'
  )
  expect(getSmallFastModel()).toBe(getMainLoopModel())
  expect(getSmallFastModel()).not.toBe('qwen2.5-coder:7b')
})

test('Ollama secondary calls do not auto-load another installed model', async () => {
  process.env.OLLAMA_MODEL = 'main-session-model:latest'
  const { getSmallFastModel } = await import('../src/utils/model/model.ts')
  expect(getSmallFastModel()).toBe('main-session-model:latest')

  process.env.OLLAMA_SMALL_FAST_MODEL = 'explicit-helper-model:latest'
  expect(getSmallFastModel()).toBe('explicit-helper-model:latest')
})

test('external provider secondary calls use the selected live model', async () => {
  const { getSmallFastModel } = await import('../src/utils/model/model.ts')
  expect(
    getSmallFastModel({
      active: 'openrouter',
      model: 'qwen/qwen3.8-max',
    }),
  ).toBe('qwen/qwen3.8-max')
  expect(
    getSmallFastModel({
      active: 'openai-api',
      model: 'gpt-5.4',
    }),
  ).toBe('gpt-5.4')
})

test('a failed summarisation throws instead of posing as the page', () => {
  // Returning the error as content is what poisoned the ledger: downstream
  // there is no way to tell an API error from a document that happens to
  // discuss one.
  const source = readFileSync('src/tools/WebFetchTool/utils.ts', 'utf8')
  const index = source.indexOf('isApiErrorMessage')
  expect(index).toBeGreaterThan(-1)
  const region = source.slice(index, index + 300)
  expect(region).toContain('throw new Error')
  expect(region).toContain('summarising it failed')
})
