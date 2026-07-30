import { expect, test } from 'bun:test'
import {
  describeOversizedOllamaRequest,
  isOllamaRequestTooLarge,
} from '../src/services/api/ollama.ts'

// Reported in normal use as:
//   API Error: Ollama request failed (400): http: request body too large
//
// That is Go's net/http MaxBytesReader rejecting the payload by byte size. It
// is not the model's context window, so the token-based context-pressure
// warning never fires for it — a couple of screenshots can exceed the byte
// limit while the token estimate still looks fine. Raw, the message names
// neither the cause nor a way out.

test('the Go net/http rejection is recognised', () => {
  expect(isOllamaRequestTooLarge(400, 'http: request body too large')).toBe(
    true,
  )
})

test('the 413 spelling is recognised too', () => {
  // Behind a reverse proxy the same condition arrives as 413 with different
  // wording, so matching only the Go string would miss the proxied case.
  expect(isOllamaRequestTooLarge(413, 'Payload Too Large')).toBe(true)
  expect(isOllamaRequestTooLarge(413, 'request entity too large')).toBe(true)
})

test('unrelated failures are not claimed by this classifier', () => {
  // Misclassifying here would replace a correct error with confident,
  // irrelevant advice — worse than the raw message.
  expect(isOllamaRequestTooLarge(400, 'model not found')).toBe(false)
  expect(isOllamaRequestTooLarge(500, 'internal error')).toBe(false)
  expect(isOllamaRequestTooLarge(404, 'http: request body too large')).toBe(
    false,
  )
})

test('the message states the size, the cause, and a remedy', () => {
  const message = describeOversizedOllamaRequest(3_500_000)
  expect(message).toContain('3.3 MB')
  expect(message).toMatch(/image/i)
  expect(message).toContain('/compact')
  // The distinction that makes this actionable rather than confusing.
  expect(message).toMatch(/not the model's context window/i)
})

test('an unknown size degrades to advice without inventing a number', () => {
  const message = describeOversizedOllamaRequest(undefined)
  expect(message).not.toMatch(/\bNaN\b|undefined|0 bytes/)
  expect(message).toContain('/compact')
})

test('sizes are formatted at a readable scale', () => {
  expect(describeOversizedOllamaRequest(900)).toContain('900 bytes')
  expect(describeOversizedOllamaRequest(20_480)).toContain('20 KB')
  expect(describeOversizedOllamaRequest(10 * 1024 * 1024)).toContain('10.0 MB')
})

test('the proxy case is mentioned, since the limit may not be Ollama at all', () => {
  // A user pointing UR at a remote host through nginx hits the proxy limit
  // first, and tuning Ollama would not help.
  expect(describeOversizedOllamaRequest(1)).toContain('client_max_body_size')
})
