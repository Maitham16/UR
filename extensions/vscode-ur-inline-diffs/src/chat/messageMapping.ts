// Pure mapping from raw stream-json NDJSON messages (src/cli/structuredIO.ts
// wire shapes) to this extension's ChatContentBlock model. No vscode import
// — directly testable, and reused by chatController.ts for every assistant/
// tool-result line that arrives on a turn.

import type { ChatContentBlock } from '../bridge/types.js'

export function extractAssistantContentBlocks(message: unknown): ChatContentBlock[] {
  const content = (message as { message?: { content?: unknown } })?.message?.content
  if (!Array.isArray(content)) return []
  const blocks: ChatContentBlock[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const typed = block as { type?: unknown; text?: unknown; id?: unknown; name?: unknown; input?: unknown }
    if (typed.type === 'text' && typeof typed.text === 'string') {
      blocks.push({ type: 'text', text: typed.text })
    } else if (typed.type === 'tool_use' && typeof typed.id === 'string' && typeof typed.name === 'string') {
      blocks.push({ type: 'tool_use', id: typed.id, name: typed.name, input: typed.input })
    }
  }
  return blocks
}

export function extractToolResultContentBlocks(message: unknown): ChatContentBlock[] {
  const content = (message as { message?: { content?: unknown } })?.message?.content
  if (!Array.isArray(content)) return []
  const blocks: ChatContentBlock[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const typed = block as { type?: unknown; tool_use_id?: unknown; is_error?: unknown; content?: unknown }
    if (typed.type === 'tool_result' && typeof typed.tool_use_id === 'string') {
      blocks.push({
        type: 'tool_result',
        toolUseId: typed.tool_use_id,
        ok: typed.is_error !== true,
        summary: summarizeToolResultContent(typed.content),
      })
    }
  }
  return blocks
}

export function summarizeToolResultContent(content: unknown, max = 800): string {
  if (typeof content === 'string') return truncate(content, max)
  if (Array.isArray(content)) {
    const text = content
      .map(block => (block && typeof block === 'object' && 'text' in block ? String((block as { text: unknown }).text) : ''))
      .filter(Boolean)
      .join('\n')
    return truncate(text || JSON.stringify(content), max)
  }
  return truncate(JSON.stringify(content ?? ''), max)
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}
