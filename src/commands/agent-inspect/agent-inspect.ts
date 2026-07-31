import { readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
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
 * The subagents directory worth reporting on.
 *
 * Resolving the *live* session is useless: every `ur` invocation mints a new
 * session id, so a bare `ur agent-inspect --costs` always pointed at a session
 * created milliseconds earlier that had by definition spawned nothing. Two
 * consecutive runs in the same directory produced two different empty session
 * ids and no data either time.
 *
 * So fall back to the most recent session in this project that actually has
 * subagent transcripts. The live session is still preferred when it has any,
 * which is the case when this runs as `/agent-inspect` inside a session that
 * has already fanned out.
 */
function resolveSessionSubagentsDir(): string | null {
  let live: string
  try {
    live = dirname(getAgentTranscriptPath('probe' as never))
  } catch {
    return null
  }
  if (hasTranscripts(live)) return live

  // {projectDir}/{sessionId}/subagents — walk up two levels to the project.
  const projectDir = dirname(dirname(live))
  let sessions: string[]
  try {
    sessions = readdirSync(projectDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => join(projectDir, entry.name, 'subagents'))
      .filter(hasTranscripts)
  } catch {
    return live
  }
  if (sessions.length === 0) return live
  // Most recently written wins; an older fan-out is rarely the one being asked
  // about.
  return sessions.sort(
    (a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs,
  )[0]!
}

function hasTranscripts(dir: string): boolean {
  try {
    return readdirSync(dir).some(
      name => name.startsWith('agent-') && name.endsWith('.jsonl'),
    )
  } catch {
    return false
  }
}
