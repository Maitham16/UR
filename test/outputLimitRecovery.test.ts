import { describe, expect, test } from 'bun:test'
import { OutputLimitRecoveryTracker } from '../src/query/outputLimitRecovery.js'

function output(text: string) {
  return [{ message: { content: [{ type: 'text', text }] } }]
}

describe('output-limit continuation', () => {
  test('has no fixed continuation ceiling while output keeps making progress', () => {
    const tracker = new OutputLimitRecoveryTracker()
    for (let index = 0; index < 100; index++) {
      const decision = tracker.record(output(`novel continuation ${index}`))
      expect(decision.shouldContinue).toBe(true)
      expect(decision.continuationCount).toBe(index + 1)
    }
  })

  test('stops an empty provider loop after consecutive no-progress responses', () => {
    const tracker = new OutputLimitRecoveryTracker()
    expect(tracker.record([])).toMatchObject({
      shouldContinue: true,
      stallReason: 'empty',
      consecutiveStalls: 1,
    })
    expect(tracker.record([])).toMatchObject({
      shouldContinue: false,
      stallReason: 'empty',
      consecutiveStalls: 2,
    })
  })

  test('stops exact replay but permits new output and resets between phases', () => {
    const tracker = new OutputLimitRecoveryTracker()
    expect(tracker.record(output('first'))).toMatchObject({ shouldContinue: true })
    expect(tracker.record(output('first'))).toMatchObject({
      shouldContinue: true,
      stallReason: 'repeated',
    })
    expect(tracker.record(output('first'))).toMatchObject({
      shouldContinue: false,
      stallReason: 'repeated',
    })

    tracker.reset()
    expect(tracker.record(output('first'))).toMatchObject({
      shouldContinue: true,
      continuationCount: 1,
      consecutiveStalls: 0,
    })
  })

  test('does not retain opaque provider reasoning while detecting its replay', () => {
    const tracker = new OutputLimitRecoveryTracker()
    const reasoning = [{
      message: {
        content: [{ type: 'redacted_thinking', data: 'provider-secret-payload' }],
      },
    }]
    expect(tracker.record(reasoning).stallReason).toBeUndefined()
    expect(tracker.record(reasoning).stallReason).toBe('repeated')
  })
})
