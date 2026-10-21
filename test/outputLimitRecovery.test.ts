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
      expect(decision.hasVisibleContent).toBe(true)
      expect(decision.consecutiveInvisibleResponses).toBe(0)
    }
  })

  test('stops an empty provider loop after consecutive no-progress responses', () => {
    const tracker = new OutputLimitRecoveryTracker()
    expect(tracker.record([])).toMatchObject({
      shouldContinue: true,
      stallReason: 'empty',
      consecutiveStalls: 1,
      hasVisibleContent: false,
      hasReasoningContent: false,
      consecutiveInvisibleResponses: 1,
    })
    expect(tracker.record([])).toMatchObject({
      shouldContinue: false,
      stallReason: 'empty',
      consecutiveStalls: 2,
      consecutiveInvisibleResponses: 2,
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
      consecutiveInvisibleResponses: 0,
    })
  })

  test('compares actual opaque reasoning bytes, including equal-sized distinct payloads', () => {
    const tracker = new OutputLimitRecoveryTracker()
    const reasoning = (data: string) => [{
      message: {
        content: [{ type: 'redacted_thinking', data }],
      },
    }]
    for (const data of ['aaaa', 'bbbb', 'cccc']) {
      expect(tracker.record(reasoning(data))).toMatchObject({
        shouldContinue: true,
        hasVisibleContent: false,
        hasReasoningContent: true,
        consecutiveStalls: 0,
      })
    }
    expect(tracker.record(reasoning('cccc')).stallReason).toBe('repeated')
    expect(tracker.record(reasoning('cccc')).shouldContinue).toBe(false)
    // The tracker holds only digests and counters after record() returns.
    expect(JSON.stringify([...((tracker as any).seen as Set<string>)]))
      .not.toMatch(/aaaa|bbbb|cccc/)
  })

  test('preserves meaningful whitespace in generated code and strings', () => {
    const tracker = new OutputLimitRecoveryTracker()
    for (const text of [
      'if condition:\n    first()\n    second()',
      'if condition:\n    first()\nsecond()',
      'if condition:\nfirst()\n    second()',
      'print("a  b")',
      'print("a b")',
    ]) {
      expect(tracker.record(output(text))).toMatchObject({
        shouldContinue: true,
        consecutiveStalls: 0,
      })
    }
  })

  test('detects replay across content blocks, messages, line endings and changing metadata', () => {
    const tracker = new OutputLimitRecoveryTracker()
    expect(tracker.record([{
      message: { content: [
        { type: 'text', text: 'first\r' },
        { type: 'thinking', thinking: 'reasoning ' },
        { type: 'text', text: '\nsecond', citations: ['old citation'] },
        { type: 'thinking', thinking: 'trace', signature: 'old signature' },
      ] },
    }]).shouldContinue).toBe(true)
    expect(tracker.record([
      { message: { content: [{ type: 'thinking', thinking: 'reasoning trace' }] } },
      { message: { content: [{ type: 'text', text: 'first\nsecond', citations: ['new citation'] }] } },
      { message: { content: [{ type: 'provider_metadata', request_id: 'different request' }] } },
    ])).toMatchObject({ shouldContinue: true, stallReason: 'repeated' })
    expect(tracker.record([{
      message: { content: [
        { type: 'text', text: 'first\nsecond', request_id: 'third request' },
        { type: 'thinking', thinking: 'reasoning trace', signature: 'third signature' },
      ] },
    }])).toMatchObject({ shouldContinue: false, stallReason: 'repeated' })
  })

  test('canonicalizes raw string content and opaque block segmentation', () => {
    const tracker = new OutputLimitRecoveryTracker()
    const first = tracker.record([
      { message: { content: 'visible ' } },
      { message: { content: [{ type: 'text', text: 'answer' }, { type: 'redacted_thinking', data: 'opaque-data' }] } },
    ])
    expect(first.shouldContinue).toBe(true)
    expect(tracker.record([{
      message: { content: [
        { type: 'redacted_thinking', data: 'opaque-' },
        { type: 'text', text: 'visible answer' },
        { type: 'redacted_thinking', data: 'data', signature: 'new signature' },
      ] },
    }]).stallReason).toBe('repeated')
    const opaqueTracker = new OutputLimitRecoveryTracker()
    opaqueTracker.record([{ message: { content: [{ type: 'redacted_thinking', data: 'opaque-data' }] } }])
    expect(opaqueTracker.record([{ message: { content: [
      { type: 'redacted_thinking', data: 'opaque-' },
      { type: 'redacted_thinking', data: 'data' },
    ] } }]).stallReason).toBe('repeated')
  })

  test('fresh hidden reasoning cannot disguise an identical visible answer', () => {
    const tracker = new OutputLimitRecoveryTracker()
    for (const index of [0, 1, 2]) {
      expect(tracker.record([{ message: { content: [
        { type: 'text', text: 'The same visible answer.' },
        { type: 'thinking', thinking: `Different reasoning ${index}` },
        { type: 'redacted_thinking', data: `Different opaque payload ${index}` },
      ] } }])).toMatchObject({
        shouldContinue: index < 2,
        consecutiveStalls: index,
        hasVisibleContent: true,
        hasReasoningContent: true,
      })
    }
  })

  test('metadata, unsupported blocks and synthetic errors cannot manufacture progress', () => {
    const tracker = new OutputLimitRecoveryTracker()
    for (const index of [1, 2]) {
      expect(tracker.record([
        { message: { content: [{ type: 'provider_metadata', timestamp: index, nested: { text: `novel ${index}` } }] } },
        { message: { content: [{ type: 'text', text: ' \n\t' }, { type: 'thinking', thinking: ' ' }] } },
        { isApiErrorMessage: true, message: { content: [{ type: 'text', text: `error ${index}` }] } },
      ])).toMatchObject({
        shouldContinue: index < 2,
        stallReason: 'empty',
        hasVisibleContent: false,
        hasReasoningContent: false,
        consecutiveInvisibleResponses: index,
      })
    }
  })

  test('counts reasoning-only and empty responses until visible output or reset', () => {
    const tracker = new OutputLimitRecoveryTracker()
    const reasoning = (thinking: string) => [{ message: { content: [{ type: 'thinking', thinking }] } }]
    expect(tracker.record(reasoning('first thought'))).toMatchObject({
      hasVisibleContent: false,
      hasReasoningContent: true,
      consecutiveInvisibleResponses: 1,
    })
    expect(tracker.record(reasoning('next thought')).consecutiveInvisibleResponses).toBe(2)
    expect(tracker.record(output('result'))).toMatchObject({
      hasVisibleContent: true,
      hasReasoningContent: false,
      consecutiveInvisibleResponses: 0,
    })
    expect(tracker.record(reasoning('another thought')).consecutiveInvisibleResponses).toBe(1)
    expect(tracker.record([])).toMatchObject({
      hasVisibleContent: false,
      hasReasoningContent: false,
      consecutiveInvisibleResponses: 2,
    })
    tracker.reset()
    expect(tracker.record(reasoning('first thought'))).toMatchObject({
      continuationCount: 1,
      consecutiveStalls: 0,
      consecutiveInvisibleResponses: 1,
    })
  })
})
