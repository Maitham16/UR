import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  describeImageRetry,
  dropStaleImagesFromRequest,
} from '../src/services/api/ollama.ts'

// A 19.6 MB request was rejected with "http: request body too large". 1.68.3
// explained that clearly but recovered from nothing, leaving the user to run
// /compact by hand. UR already had both halves of the fix — isMediaSizeError
// and stripImagesFromMessages — wired to reactive compact's retry. That
// subsystem is behind REACTIVE_COMPACT, which is not compiled into any shipped
// build, so neither was reachable. The recovery now lives on the Ollama path,
// where the rejection actually lands.

const req = (messages: unknown[]) =>
  ({ model: 'test', stream: false, messages }) as never

const image = (n: number) => Array.from({ length: n }, (_, i) => `B64_${i}`)

test('images from earlier turns are dropped, the newest is kept', () => {
  const result = dropStaleImagesFromRequest(
    req([
      { role: 'user', images: image(2) },
      { role: 'assistant' },
      { role: 'user', images: image(3) },
    ]),
  )!
  expect(result.messages[0]!.images).toBeUndefined()
  expect(result.messages[2]!.images).toHaveLength(3)
})

test('the newest image is kept, not the largest or the first', () => {
  // The most recent attachment is the one still being discussed.
  const result = dropStaleImagesFromRequest(
    req([
      { role: 'user', images: image(9) },
      { role: 'user', images: image(1) },
    ]),
  )!
  expect(result.messages[0]!.images).toBeUndefined()
  expect(result.messages[1]!.images).toHaveLength(1)
})

test('one image means no retry, rather than an identical resend', () => {
  // Returning a request here would resend the same bytes and fail the same
  // way — a retry that cannot succeed is worse than reporting the error.
  expect(
    dropStaleImagesFromRequest(req([{ role: 'user', images: image(4) }])),
  ).toBeNull()
})

test('no images means no retry', () => {
  expect(
    dropStaleImagesFromRequest(
      req([{ role: 'user' }, { role: 'assistant' }]),
    ),
  ).toBeNull()
})

test('messages without images are untouched', () => {
  const result = dropStaleImagesFromRequest(
    req([
      { role: 'user', images: image(1) },
      { role: 'assistant', content: 'keep me' },
      { role: 'user', images: image(1) },
    ]),
  )!
  expect(result.messages[1]).toEqual({ role: 'assistant', content: 'keep me' })
})

test('request-level fields survive the rewrite', () => {
  const result = dropStaleImagesFromRequest(
    req([
      { role: 'user', images: image(1) },
      { role: 'user', images: image(1) },
    ]),
  )!
  expect(result.model).toBe('test')
  expect(result.stream).toBe(false)
})

test('the payload actually gets smaller', () => {
  // The point is bytes, not tidiness.
  const original = req([
    { role: 'user', images: ['x'.repeat(500_000)] },
    { role: 'user', images: ['y'.repeat(500_000)] },
  ])
  const before = JSON.stringify(original).length
  const after = JSON.stringify(dropStaleImagesFromRequest(original)).length
  expect(after).toBeLessThan(before / 1.8)
})

test('the user is told the retry happened and what was lost', () => {
  // Silently dropping the user's attachments would be the same invisible
  // behaviour this codebase keeps getting wrong.
  const message = describeImageRetry(20_500_000, 3_100_000)
  expect(message).toContain('19.6 MB')
  expect(message).toContain('3.0 MB')
  expect(message).toMatch(/re-attach/i)
})

test('the retry is wired into the request path, not just defined', () => {
  const source = readFileSync('src/services/api/ollama.ts', 'utf8')
  const at = source.indexOf('const retryRequest')
  expect(at).toBeGreaterThan(-1)
  const block = source.slice(at, at + 900)
  expect(block).toContain('isOllamaRequestTooLarge')
  expect(block).toContain('dropStaleImagesFromRequest')
  expect(block).toContain('pendingProviderNotice')
})
