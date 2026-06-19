import {
  type MessageLike,
  formatInspection,
  inspectMessages,
  loadTranscript,
} from '../../services/agents/inspector.js'
import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'

export const call: LocalCommandCall = async (args, context) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const fileIndex = tokens.indexOf('--file')
  const filePath = fileIndex >= 0 ? tokens[fileIndex + 1] : undefined

  let messages: MessageLike[]
  if (filePath) {
    try {
      messages = loadTranscript(filePath)
    } catch (error) {
      return {
        type: 'text',
        value: error instanceof Error ? error.message : String(error),
      }
    }
  } else {
    const ctx = context as { messages?: MessageLike[] } | undefined
    messages = ctx?.messages ?? []
    if (messages.length === 0) {
      return {
        type: 'text',
        value:
          'No in-session messages available. Run inside a session, or pass a transcript: ur agent-inspect --file <path.jsonl>',
      }
    }
  }

  const report = inspectMessages(messages)
  return { type: 'text', value: formatInspection(report, json) }
}
