import { dirname } from 'node:path'
import {
  type MessageLike,
  formatInspection,
  formatSubagentCosts,
  inspectMessages,
  loadTranscript,
  summarizeSubagentCosts,
} from '../../services/agents/inspector.js'
import { getAgentTranscriptPath } from '../../utils/sessionStorage.js'
import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'

export const call: LocalCommandCall = async (args, context) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const fileIndex = tokens.indexOf('--file')
  const filePath = fileIndex >= 0 ? tokens[fileIndex + 1] : undefined

  // Subagent spend lives in sibling transcripts, not in the parent's messages,
  // so it needs its own path rather than being derivable from --file.
  const costsIndex = tokens.indexOf('--costs')
  if (costsIndex >= 0) {
    const dir = tokens[costsIndex + 1] ?? resolveSessionSubagentsDir()
    if (!dir) {
      return {
        type: 'text',
        value:
          'Could not locate a session directory. Pass one: ur agent-inspect --costs <sessionDir>/subagents',
      }
    }
    return {
      type: 'text',
      value: formatSubagentCosts(summarizeSubagentCosts(dir), json, dir),
    }
  }

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

/**
 * The subagents directory for the live session. Derived from
 * getAgentTranscriptPath with a throwaway id so the layout stays defined in
 * one place — duplicating the join here would silently drift if it ever moves.
 */
function resolveSessionSubagentsDir(): string | null {
  try {
    return dirname(getAgentTranscriptPath('probe' as never))
  } catch {
    return null
  }
}
