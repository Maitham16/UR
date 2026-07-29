import { describe, expect, test } from 'bun:test'
import { isWebviewInboundMessage } from './webviewProtocol.js'

describe('isWebviewInboundMessage', () => {
  test('accepts every supported well-formed message', () => {
    for (const message of [
      { type: 'ready' },
      { type: 'cancel' },
      { type: 'send', text: 'Review this file' },
      {
        type: 'permissionDecision',
        requestId: 'request-1',
        decision: 'deny',
      },
      { type: 'removeAttachment', index: 0 },
    ]) {
      expect(isWebviewInboundMessage(message)).toBe(true)
    }
  })

  test('rejects malformed and unsafe webview messages', () => {
    for (const message of [
      null,
      {},
      { type: 'send', text: 42 },
      { type: 'send', text: 'bad\0prompt' },
      { type: 'permissionDecision', requestId: '', decision: 'allow' },
      {
        type: 'permissionDecision',
        requestId: 'request-1',
        decision: 'always-allow',
      },
      { type: 'removeAttachment', index: -1 },
      { type: 'removeAttachment', index: 1.5 },
      { type: 'unknown' },
    ]) {
      expect(isWebviewInboundMessage(message)).toBe(false)
    }
  })
})
