import { describe, expect, test } from 'bun:test'
import { parseSSEFrames, parseStreamClientEvent } from '../src/cli/transports/SSETransport.ts'

const validEvent = {
  event_id: 'event-1',
  sequence_num: 1,
  event_type: 'message',
  source: 'client',
  payload: { type: 'user', message: 'hello' },
  created_at: '2026-01-01T00:00:00.000Z',
}

describe('SSE frame parsing', () => {
  test('preserves an incomplete trailing frame', () => {
    const parsed = parseSSEFrames('event: client_event\nid: 1\ndata: {}\n\nevent: next')
    expect(parsed.frames).toEqual([{ event: 'client_event', id: '1', data: '{}' }])
    expect(parsed.remaining).toBe('event: next')
  })

  test('combines multiple data fields and emits keepalive comments', () => {
    const parsed = parseSSEFrames(':keepalive\n\nevent: client_event\ndata: one\ndata: two\n\n')
    expect(parsed.frames).toEqual([{}, { event: 'client_event', data: 'one\ntwo' }])
  })
})

describe('stream client event validation', () => {
  test('accepts a complete client event', () => {
    expect(parseStreamClientEvent('client_event', JSON.stringify(validEvent))).toEqual(validEvent)
  })

  test('rejects unknown variants, malformed JSON, sequence zero, and untyped payloads', () => {
    expect(() => parseStreamClientEvent('delivery_update', JSON.stringify(validEvent))).toThrow('Unexpected SSE event type')
    expect(() => parseStreamClientEvent('client_event', '{')).toThrow('Failed to parse')
    expect(() => parseStreamClientEvent('client_event', JSON.stringify({ ...validEvent, sequence_num: 0 }))).toThrow('payload shape')
    expect(() => parseStreamClientEvent('client_event', JSON.stringify({ ...validEvent, payload: {} }))).toThrow('payload shape')
  })
})
