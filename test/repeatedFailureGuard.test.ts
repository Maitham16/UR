import { beforeEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  REPEATED_FAILURE_DEFAULTS,
  callSignature,
  checkRepeatedFailure,
  recordCallFailure,
  recordCallSuccess,
  resetRepeatedFailuresForTesting,
} from '../src/services/tools/repeatedFailureGuard.ts'

// A 4B model refused once by the task-list gate replied by emitting `Write`
// with no arguments, over and over, plus `Computer(type 0 chars)`. Nothing
// stopped it. The trajectory grader names this pattern but only after the run
// has ended, so it could grade the wreck and never prevent it.

beforeEach(() => resetRepeatedFailuresForTesting())

const SIG = 'Write:{}'

test('a call is allowed until it has failed repeatedly', () => {
  expect(checkRepeatedFailure(SIG).action).toBe('allow')
  recordCallFailure(SIG)
  recordCallFailure(SIG)
  // Two failures are plausible: a transient error, then a fix that fails the
  // same way. The third is a loop.
  expect(checkRepeatedFailure(SIG).action).toBe('allow')
  recordCallFailure(SIG)
  expect(checkRepeatedFailure(SIG).action).toBe('refuse')
})

test('the refusal tells the model to change course, not just to stop', () => {
  for (let i = 0; i < REPEATED_FAILURE_DEFAULTS.limit; i++) recordCallFailure(SIG)
  const decision = checkRepeatedFailure(SIG)
  const reason = (decision as { reason: string }).reason
  expect(reason).toContain('Do not retry it unchanged')
  expect(reason).toContain('tell the user')
})

test('persisting past the refusal aborts the turn', () => {
  // Otherwise a model that ignores the refusal loops on the refusal instead.
  for (let i = 0; i < REPEATED_FAILURE_DEFAULTS.abortAfter; i++) {
    recordCallFailure(SIG)
  }
  expect(checkRepeatedFailure(SIG).action).toBe('abort')
})

test('a corrected retry is never penalised', () => {
  // This is what a refusal asks the model to do, so blocking it would punish
  // exactly the recovery we want.
  const broken = callSignature('Write', {})
  const fixed = callSignature('Write', { file_path: '/a.ts', content: 'x' })
  for (let i = 0; i < 5; i++) recordCallFailure(broken)
  expect(checkRepeatedFailure(broken).action).not.toBe('allow')
  expect(checkRepeatedFailure(fixed).action).toBe('allow')
})

test('signatures ignore key order', () => {
  expect(callSignature('Write', { a: 1, b: 2 })).toBe(
    callSignature('Write', { b: 2, a: 1 }),
  )
})

test('unserializable input does not throw on a hot path', () => {
  const circular: Record<string, unknown> = {}
  circular.self = circular
  expect(() => callSignature('Write', circular)).not.toThrow()
})

test('success clears the history for that call', () => {
  for (let i = 0; i < REPEATED_FAILURE_DEFAULTS.limit; i++) recordCallFailure(SIG)
  expect(checkRepeatedFailure(SIG).action).toBe('refuse')
  recordCallSuccess(SIG)
  expect(checkRepeatedFailure(SIG).action).toBe('allow')
})

test('the gate and validation both feed the guard', () => {
  // The observed loop was rejected by input validation every time. If those
  // rejections are not recorded, the guard never counts and never fires.
  const source = readFileSync('src/services/tools/toolExecution.ts', 'utf8')
  const gateAt = source.indexOf('if (!gate.allowed)')
  const validationAt = source.indexOf('if (!parsedInput.success)')
  expect(source.slice(gateAt, gateAt + 300)).toContain('recordCallFailure')
  expect(source.slice(validationAt, validationAt + 300)).toContain(
    'recordCallFailure',
  )
})
