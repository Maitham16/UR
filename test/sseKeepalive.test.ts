import { describe, expect, test } from 'bun:test'
import {
  createAnthropicSSEMessageStream,
  createGeminiSSEMessageStream,
  createOpenAISSEMessageStream,
} from '../src/services/api/streamingAdapters.js'

const encoder = new TextEncoder()

function sseBody(parts: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part))
      controller.close()
    },
  })
}

async function collect(stream: AsyncIterable<any>): Promise<any[]> {
  const events: any[] = []
  for await (const event of stream) events.push(event)
  return events
}

function textOf(events: any[]): string {
  return events
    .filter(event => event.type === 'content_block_delta' && event.delta?.text)
    .map(event => event.delta.text)
    .join('')
}

/**
 * Keepalive bytes are the only evidence that a provider is still working
 * during a long prefill. Swallowing them made an active stream look frozen to
 * the inactivity watchdog, which then aborted it as a timeout.
 */
describe('SSE keepalives reach the inactivity watchdog', () => {
  test('OpenAI-compatible comment keepalives surface as pings', async () => {
    const events = await collect(
      createOpenAISSEMessageStream(
        sseBody([
          ': OPENROUTER PROCESSING\n\n',
          ': OPENROUTER PROCESSING\n\n',
          'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
        { model: 'test-model', requestId: 'req-1' },
      ),
    )

    expect(events.filter(event => event.type === 'ping')).toHaveLength(2)
    expect(textOf(events)).toBe('hi')
  })

  test('Anthropic ping events are forwarded rather than dropped', async () => {
    const events = await collect(
      createAnthropicSSEMessageStream(
        sseBody([
          'event: ping\ndata: {"type":"ping"}\n\n',
          'data: {"type":"message_start","message":{"id":"x","model":"test-model","usage":{}}}\n\n',
          'data: {"type":"message_stop"}\n\n',
        ]),
        { model: 'test-model', requestId: 'req-2' },
      ),
    )

    expect(events.filter(event => event.type === 'ping')).toHaveLength(1)
    expect(events.at(-1)?.type).toBe('message_stop')
  })

  test('Gemini comment keepalives surface as pings', async () => {
    const events = await collect(
      createGeminiSSEMessageStream(
        sseBody([
          ': keepalive\n\n',
          'data: {"candidates":[{"content":{"parts":[{"text":"gm"}]},"finishReason":"STOP"}]}\n\n',
        ]),
        { model: 'test-model', requestId: 'req-3' },
      ),
    )

    expect(events.filter(event => event.type === 'ping')).toHaveLength(1)
    expect(textOf(events)).toBe('gm')
  })

  test('an event split across network chunks keeps its content intact', async () => {
    const events = await collect(
      createOpenAISSEMessageStream(
        sseBody([
          'data: {"choices":[{"delta":{"con',
          'tent":"hello world"}}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
          'data: [DONE]\n\n',
        ]),
        { model: 'test-model', requestId: 'req-4' },
      ),
    )

    expect(textOf(events)).toBe('hello world')
  })
})
