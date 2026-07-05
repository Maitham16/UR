import { expect, test } from 'bun:test'
import { createOpenAISSEMessageStream } from '../src/services/api/streamingAdapters.ts'
import { parseOpenAICompatibleResponse } from '../src/services/api/openaiCompatible.ts'

function sseBody(chunks: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })
}

async function collect(stream: { [Symbol.asyncIterator](): AsyncIterator<any> }) {
  const events: any[] = []
  for await (const event of stream) events.push(event)
  return events
}

test('streams reasoning_content as a thinking block and content as text', async () => {
  const body = sseBody([
    { choices: [{ delta: { role: 'assistant' }, index: 0 }] },
    { choices: [{ delta: { reasoning_content: 'Let me think. ' }, index: 0 }] },
    { choices: [{ delta: { reasoning_content: 'Done.' }, index: 0 }] },
    { choices: [{ delta: { content: 'Hello!' }, index: 0 }] },
    { choices: [{ delta: {}, finish_reason: 'stop', index: 0 }] },
  ])
  const events = await collect(createOpenAISSEMessageStream(body, { providerName: 'openai-compatible' }))

  const thinking = events
    .filter(e => e.type === 'content_block_delta' && e.delta?.type === 'thinking_delta')
    .map(e => e.delta.thinking)
    .join('')
  const text = events
    .filter(e => e.type === 'content_block_delta' && e.delta?.type === 'text_delta')
    .map(e => e.delta.text)
    .join('')

  expect(thinking).toBe('Let me think. Done.')
  expect(text).toBe('Hello!')
  // thinking block opens and closes before text
  const starts = events.filter(e => e.type === 'content_block_start').map(e => e.content_block.type)
  expect(starts).toEqual(['thinking', 'text'])
})

test('reasoning-only response still yields a visible thinking block (not empty)', async () => {
  const body = sseBody([
    { choices: [{ delta: { reasoning_content: 'Reasoning but no answer field.' }, index: 0 }] },
    { choices: [{ delta: {}, finish_reason: 'stop', index: 0 }] },
  ])
  const events = await collect(createOpenAISSEMessageStream(body, { providerName: 'openai-compatible' }))

  const thinkingStart = events.find(
    e => e.type === 'content_block_start' && e.content_block.type === 'thinking',
  )
  expect(thinkingStart).toBeDefined()
  const thinking = events
    .filter(e => e.delta?.type === 'thinking_delta')
    .map(e => e.delta.thinking)
    .join('')
  expect(thinking).toBe('Reasoning but no answer field.')
})

test('non-streaming parse surfaces reasoning_content as a thinking block', () => {
  const parsed = parseOpenAICompatibleResponse(
    {
      id: 'x',
      model: 'nemotron',
      choices: [
        {
          message: { role: 'assistant', reasoning_content: 'thinking...', content: 'Answer.' },
          finish_reason: 'stop',
        },
      ],
    },
    'nemotron',
  )
  expect(parsed.content).toEqual([
    { type: 'thinking', thinking: 'thinking...' },
    { type: 'text', text: 'Answer.' },
  ])
})

test('plain content stream is unchanged', async () => {
  const body = sseBody([
    { choices: [{ delta: { content: 'Hi' }, index: 0 }] },
    { choices: [{ delta: { content: ' there' }, index: 0 }] },
    { choices: [{ delta: {}, finish_reason: 'stop', index: 0 }] },
  ])
  const events = await collect(createOpenAISSEMessageStream(body, { providerName: 'openai-compatible' }))
  const text = events
    .filter(e => e.delta?.type === 'text_delta')
    .map(e => e.delta.text)
    .join('')
  expect(text).toBe('Hi there')
  const starts = events.filter(e => e.type === 'content_block_start').map(e => e.content_block.type)
  expect(starts).toEqual(['text'])
})
