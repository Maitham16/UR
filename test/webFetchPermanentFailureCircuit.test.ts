import { beforeEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  clearRepeatedFailuresForQuery,
  RepeatedToolFailureAbort,
  resetRepeatedFailuresForTesting,
} from '../src/services/tools/repeatedFailureGuard.js'
import {
  webFetchPermanentFailureSignature,
  withWebFetchPermanentFailureCircuit,
} from '../src/tools/WebFetchTool/permanentFailureCircuit.js'
import {
  isPermanentWebFetchStatus,
  PermanentWebFetchHttpError,
} from '../src/tools/WebFetchTool/utils.js'

beforeEach(() => resetRepeatedFailuresForTesting())

test('classifies deterministic 4xx responses without trapping transient failures', () => {
  for (const status of [400, 401, 403, 404, 410, 422, 451]) {
    expect(isPermanentWebFetchStatus(status)).toBe(true)
  }
  for (const status of [301, 408, 409, 425, 429, 500, 503]) {
    expect(isPermanentWebFetchStatus(status)).toBe(false)
  }
})

test('keys permanent failures by normalized URL rather than fetch prompt', () => {
  const scope = 'query:prompt-independent'
  expect(
    webFetchPermanentFailureSignature(
      scope,
      'http://EXAMPLE.com/docs#overview',
    ),
  ).toBe(
    webFetchPermanentFailureSignature(scope, 'https://example.com/docs'),
  )
})

test('one permanent failure prevents another network request for that URL', async () => {
  let networkCalls = 0
  const run = () =>
    withWebFetchPermanentFailureCircuit(
      'https://example.com/missing',
      'query:one-url',
      async () => {
        networkCalls++
        throw new PermanentWebFetchHttpError(404)
      },
    )

  await expect(run()).rejects.toThrow('permanent HTTP 404')
  await expect(run()).rejects.toThrow('WebFetch circuit breaker')
  expect(networkCalls).toBe(1)
  await expect(run()).rejects.toBeInstanceOf(RepeatedToolFailureAbort)
  expect(networkCalls).toBe(1)
})

test('alternating dead URLs are each bounded and terminate the loop', async () => {
  const calls = new Map<string, number>()
  const run = (url: string) =>
    withWebFetchPermanentFailureCircuit(url, 'query:alternating', async () => {
      calls.set(url, (calls.get(url) ?? 0) + 1)
      throw new PermanentWebFetchHttpError(404)
    })
  const first = 'https://example.com/missing-a'
  const second = 'https://example.com/missing-b'

  await expect(run(first)).rejects.toThrow('permanent HTTP 404')
  await expect(run(second)).rejects.toThrow('permanent HTTP 404')
  await expect(run(first)).rejects.toThrow('circuit breaker')
  await expect(run(second)).rejects.toThrow('circuit breaker')
  await expect(run(first)).rejects.toBeInstanceOf(RepeatedToolFailureAbort)
  expect(calls).toEqual(
    new Map([
      [first, 1],
      [second, 1],
    ]),
  )
})

test('transient failures remain retryable and query cleanup isolates turns', async () => {
  let transientCalls = 0
  const transient = () =>
    withWebFetchPermanentFailureCircuit(
      'https://example.com/temporary',
      'query:transient',
      async () => {
        transientCalls++
        throw new Error('HTTP 503')
      },
    )
  await expect(transient()).rejects.toThrow('HTTP 503')
  await expect(transient()).rejects.toThrow('HTTP 503')
  expect(transientCalls).toBe(2)

  let permanentCalls = 0
  const permanent = () =>
    withWebFetchPermanentFailureCircuit(
      'https://example.com/missing',
      'query:cleanup',
      async () => {
        permanentCalls++
        throw new PermanentWebFetchHttpError(404)
      },
    )
  await expect(permanent()).rejects.toThrow('permanent HTTP 404')
  await expect(permanent()).rejects.toThrow('circuit breaker')
  expect(clearRepeatedFailuresForQuery('cleanup')).toBe(1)
  await expect(permanent()).rejects.toThrow('permanent HTTP 404')
  expect(permanentCalls).toBe(2)
})

test('tool execution propagates a circuit-breaker abort to the query loop', () => {
  const source = readFileSync('src/services/tools/toolExecution.ts', 'utf8')
  const executionCatch = source.indexOf(
    '} catch (error) {\n    const durationMs = Date.now() - startTime',
  )
  expect(executionCatch).toBeGreaterThan(-1)
  expect(source.slice(executionCatch, executionCatch + 700)).toContain(
    'if (error instanceof RepeatedToolFailureAbort) throw error',
  )
})
