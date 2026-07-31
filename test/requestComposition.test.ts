import { expect, test } from 'bun:test'
import { describeRequestComposition } from '../src/services/api/ollama.ts'

// The fixed per-request cost of tool definitions and the system prompt decides
// whether a small-context model has room left to work. It had only been
// estimated by summing prompt source, which double-counts every
// `condition ? longText : shortText` — only one branch is ever sent. That
// estimate was reported twice before the flaw was noticed. This measures the
// serialized request instead: what the server receives, not what the source
// could produce.

const req = (over: Record<string, unknown> = {}) =>
  ({
    model: 'test',
    stream: false,
    messages: [{ role: 'user', content: 'hi' }],
    ...over,
  }) as never

test('tool definitions are reported with their share and count', () => {
  const request = req({
    tools: [
      { type: 'function', function: { name: 'A', description: 'x'.repeat(500) } },
      { type: 'function', function: { name: 'B', description: 'y'.repeat(500) } },
    ],
  })
  const total = JSON.stringify(request).length
  const line = describeRequestComposition(request, total)
  expect(line).toContain('2 defs')
  expect(line).toMatch(/tools \d/)
})

test('the system prompt is separated from the conversation', () => {
  const request = req({
    messages: [
      { role: 'system', content: 'S'.repeat(4000) },
      { role: 'user', content: 'hi' },
    ],
  })
  const total = JSON.stringify(request).length
  const line = describeRequestComposition(request, total)
  // Without the split, a large system prompt is indistinguishable from a long
  // conversation, and they call for opposite fixes.
  expect(line).toContain('system')
  expect(line).toContain('conversation')
})

test('a request with no tools reports zero, not a guess', () => {
  const line = describeRequestComposition(req(), 40)
  expect(line).toContain('0 defs')
  expect(line).toContain('tools 0 bytes')
})

test('the parts never exceed the whole', () => {
  // conversation is derived by subtraction, so a miscount would surface as a
  // negative or an over-100% share.
  const request = req({
    tools: [{ type: 'function', function: { name: 'A', description: 'x'.repeat(9000) } }],
    messages: [{ role: 'system', content: 'S'.repeat(9000) }],
  })
  const total = JSON.stringify(request).length
  const line = describeRequestComposition(request, total)
  expect(line).not.toContain('-')
  const shares = [...line.matchAll(/\((\d+)%/g)].map(m => Number(m[1]))
  expect(shares.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(101)
})

test('it degrades rather than dividing by zero', () => {
  expect(() => describeRequestComposition(req(), 0)).not.toThrow()
  expect(describeRequestComposition(req(), 0)).toContain('0%')
})
