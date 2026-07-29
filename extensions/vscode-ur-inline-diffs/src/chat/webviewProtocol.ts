import type { ChatMessage, ChatSession } from '../bridge/types.js'

export type ChatStatus = 'idle' | 'running' | 'canceled' | 'error'

export interface WireAttachment {
  label: string
}

export type WebviewInboundMessage =
  | { type: 'ready' }
  | { type: 'send'; text: string }
  | { type: 'cancel' }
  | {
      type: 'permissionDecision'
      requestId: string
      decision: 'allow' | 'deny'
    }
  | { type: 'removeAttachment'; index: number }

export type WebviewOutboundMessage =
  | {
      type: 'init'
      session: ChatSession
      messages: ChatMessage[]
      status: ChatStatus
      attachments: WireAttachment[]
    }
  | { type: 'messageAppended'; message: ChatMessage }
  | { type: 'statusChanged'; status: ChatStatus }
  | {
      type: 'permissionRequest'
      requestId: string
      toolName: string
      input: unknown
    }
  | { type: 'permissionResolved'; requestId: string }
  | { type: 'attachmentsChanged'; attachments: WireAttachment[] }
  | { type: 'errorBanner'; message: string }
  | { type: 'sessionRenamed'; title: string }

const MAX_WEBVIEW_PROMPT_LENGTH = 1_000_000
const MAX_REQUEST_ID_LENGTH = 256

/**
 * `postMessage` is a runtime boundary; its TypeScript annotation does not
 * validate data arriving from the webview. Reject malformed messages before
 * they can throw in `.trim()`, splice with a negative index, or spoof an
 * approval decision.
 */
export function isWebviewInboundMessage(
  value: unknown,
): value is WebviewInboundMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  if (value.type === 'ready' || value.type === 'cancel') return true
  if (value.type === 'send') {
    return (
      typeof value.text === 'string' &&
      value.text.length <= MAX_WEBVIEW_PROMPT_LENGTH &&
      !value.text.includes('\0')
    )
  }
  if (value.type === 'permissionDecision') {
    return (
      typeof value.requestId === 'string' &&
      value.requestId.length > 0 &&
      value.requestId.length <= MAX_REQUEST_ID_LENGTH &&
      (value.decision === 'allow' || value.decision === 'deny')
    )
  }
  if (value.type === 'removeAttachment') {
    return (
      Number.isSafeInteger(value.index) &&
      Number(value.index) >= 0 &&
      Number(value.index) <= 10_000
    )
  }
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
