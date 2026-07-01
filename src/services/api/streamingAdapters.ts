// @ts-nocheck
import { randomUUID } from 'crypto'

const EMPTY_USAGE = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
}

function normalizeUsage(usage: any = {}) {
  return {
    ...EMPTY_USAGE,
    ...usage,
  }
}

function messageText(message: any): string {
  const content = message?.content
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }
  return content
    .map(block => {
      if (typeof block === 'string') return block
      if (block?.type === 'text') return block.text ?? ''
      return ''
    })
    .join('')
}

export function createOneShotMessageStream(message: any) {
  const controller = new AbortController()
  const usage = normalizeUsage(message?.usage)
  const text = messageText(message)
  const model = message?.model ?? 'unknown'
  const id = message?.id ?? `provider-${randomUUID()}`
  const stopReason = message?.stop_reason ?? 'end_turn'

  return {
    controller,
    async *[Symbol.asyncIterator]() {
      yield {
        type: 'message_start',
        message: {
          id,
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { ...usage, output_tokens: 0 },
        },
      }
      yield {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      }
      if (text) {
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text },
        }
      }
      yield { type: 'content_block_stop', index: 0 }
      yield {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage,
      }
      yield { type: 'message_stop' }
    },
  }
}
