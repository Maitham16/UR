import { expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import {
  parseResultText,
  query,
  queryJSON,
  UrClient,
  type QueryOptions,
} from '../src/sdk/index.ts'

const fixture = fileURLToPath(
  new URL('./fixtures/sdk-child.mjs', import.meta.url),
)
const fixtureBin = { file: process.execPath, args: [fixture] }

test('parseResultText selects the terminal result from stream-json NDJSON', () => {
  const stdout = [
    JSON.stringify({ type: 'system', subtype: 'init' }),
    'diagnostic text that is not JSON',
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'final answer',
    }),
    JSON.stringify({
      type: 'system',
      subtype: 'session_state_changed',
      state: 'idle',
    }),
  ].join('\n')

  expect(parseResultText(stdout)).toBe('final answer')
})

test('parseResultText preserves intentional empty results', () => {
  expect(
    parseResultText(JSON.stringify([{ type: 'result', result: '' }])),
  ).toBe('')
})

test('parseResultText preserves mixed prose unless it has a terminal result', () => {
  const mixed = [
    'prefix prose',
    JSON.stringify({ text: 'incidental structured line' }),
    'suffix prose',
  ].join('\n')

  expect(parseResultText(mixed)).toBe(mixed)
})

test('stream-json is made CLI-valid and returns its terminal result', async () => {
  const result = await query('stream this', {
    bin: fixtureBin,
    outputFormat: 'stream-json',
    maxTurns: 3,
  })
  const details = JSON.parse(result.text) as Record<string, unknown>

  expect(result.ok).toBe(true)
  expect(details.outputFormat).toBe('stream-json')
  expect(details.verbose).toBe(true)
  expect(details.maxTurns).toBe('3')
  expect(details.prompt).toBe('stream this')
})

test('queryJSON returns null when the child exits nonzero', async () => {
  const parsed = await queryJSON('do not accept failed output', {
    bin: fixtureBin,
    env: { SDK_TEST_EXIT: '7' },
  })
  expect(parsed).toBeNull()
})

test('UrClient merges environment defaults and model wins over generic env', async () => {
  const client = new UrClient({
    bin: fixtureBin,
    model: 'default-model',
    env: {
      SDK_DEFAULT: 'present',
      SDK_SHARED: 'default',
      UR_MODEL: 'ignored-default-env-model',
    },
  })

  const parsed = await client.queryJSON<Record<string, unknown>>('merge env', {
    model: 'call-model',
    env: {
      SDK_CALL: 'present',
      SDK_SHARED: 'call',
      UR_MODEL: 'ignored-call-env-model',
    },
  })

  expect(parsed).not.toBeNull()
  expect(parsed?.defaultEnv).toBe('present')
  expect(parsed?.callEnv).toBe('present')
  expect(parsed?.sharedEnv).toBe('call')
  expect(parsed?.model).toBe('call-model')
})

test('query rejects invalid runtime inputs before spawning', async () => {
  const invalidCases: Array<[string, QueryOptions]> = [
    ['valid prompt', { bin: fixtureBin, maxTurns: 0 }],
    ['valid prompt', { bin: fixtureBin, maxTurns: 1.5 }],
    ['valid prompt', { bin: fixtureBin, timeoutMs: 0 }],
    ['valid prompt', { bin: fixtureBin, timeoutMs: Number.POSITIVE_INFINITY }],
    [
      'valid prompt',
      { bin: fixtureBin, outputFormat: 'yaml' as QueryOptions['outputFormat'] },
    ],
  ]

  await expect(query('   ', { bin: fixtureBin })).rejects.toThrow(
    'prompt must be a non-empty string',
  )
  for (const [prompt, options] of invalidCases) {
    await expect(query(prompt, options)).rejects.toThrow()
  }
})
