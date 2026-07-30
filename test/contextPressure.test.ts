import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { describeContextPressure } from '../src/utils/model/ollamaTuning.ts'

// Reported as "the agent gets stupid when prompts get long" and "it stops
// making task lists". Both are one mechanism: Ollama truncates an oversized
// prompt from the front instead of erroring, so the system prompt is the first
// thing discarded. The model then answers without its instructions, which is
// indistinguishable from the model simply being bad.

const MODEL = 'qwen3:4b'

test('a prompt past the context reports overflow', () => {
  const pressure = describeContextPressure({
    estimatedPromptTokens: 40_000,
    numCtx: 32_768,
    model: MODEL,
  })
  expect(pressure.level).toBe('overflow')
})

test('the overflow message explains the cause and gives a way out', () => {
  // A warning that only says "context exceeded" leaves the user where they
  // started: the point is that silent truncation is why quality collapsed.
  const message = describeContextPressure({
    estimatedPromptTokens: 40_000,
    numCtx: 32_768,
    model: MODEL,
  }).message!
  expect(message).toContain(MODEL)
  expect(message).toMatch(/oldest|discard|drop/i)
  expect(message).toContain('/compact')
})

test('a nearly full context warns before it overflows', () => {
  // Warning only at 100% is too late — the reply still has to fit.
  const pressure = describeContextPressure({
    estimatedPromptTokens: 29_000,
    numCtx: 32_768,
    model: MODEL,
  })
  expect(pressure.level).toBe('tight')
  expect(pressure.message).toContain('/compact')
})

test('an ordinary request stays silent', () => {
  // A notice on every turn would be trained away as noise.
  const pressure = describeContextPressure({
    estimatedPromptTokens: 4_000,
    numCtx: 32_768,
    model: MODEL,
  })
  expect(pressure.level).toBe('ok')
  expect(pressure.message).toBeUndefined()
})

test('it falls back to the model context when num_ctx is unset', () => {
  const pressure = describeContextPressure({
    estimatedPromptTokens: 9_000,
    modelContextLength: 8_192,
    model: MODEL,
  })
  expect(pressure.level).toBe('overflow')
})

test('unknown sizing never invents a warning', () => {
  // Absence of evidence is not evidence of overflow.
  expect(
    describeContextPressure({
      estimatedPromptTokens: 9_000,
      model: MODEL,
    }).level,
  ).toBe('ok')
  expect(
    describeContextPressure({
      estimatedPromptTokens: 0,
      numCtx: 32_768,
      model: MODEL,
    }).level,
  ).toBe('ok')
})

test('the request path actually surfaces the pressure', () => {
  // The detection existing but reaching no one is the failure mode this
  // codebase keeps repeating; the notice queue is what puts it in the
  // transcript rather than the debug log.
  const source = readFileSync('src/services/api/ollama.ts', 'utf8')
  expect(source).toContain('describeContextPressure')
  const at = source.indexOf('const pressure = describeContextPressure')
  expect(source.slice(at, at + 400)).toContain('pendingProviderNotice')
})
