import { dirname } from 'path'
import {
  getSessionId,
} from '../../bootstrap/state.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { gracefulShutdown } from '../../utils/gracefulShutdown.js'
import {
  archiveSession,
  listArchivedSessions,
  unarchiveSession,
} from '../../utils/sessionArchive.js'
import {
  getSessionIdFromLog,
  getTranscriptPath,
  loadAllProjectsMessageLogs,
} from '../../utils/sessionStorage.js'

const HELP = [
  'Usage: /session <status|list|archive|unarchive> [session-id]',
  '',
  '  status                 Show the current local and remote session details',
  '  list                   List resumable conversations',
  '  archive [session-id]   Archive a conversation; defaults to this session and exits',
  '  unarchive <session-id> Restore an archived conversation',
].join('\n')

function shortPath(path: string): string {
  const cwd = process.cwd()
  return path.startsWith(cwd + '/') ? `.${path.slice(cwd.length)}` : path
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const [action = 'status', sessionIdArg, ...extra] = args.trim().split(/\s+/u)
  if (extra.length > 0 || action === 'help' || action === '--help') {
    onDone(HELP, { display: 'system' })
    return null
  }

  try {
    if (action === 'status') {
      const lines = [
        `Current session: ${getSessionId()}`,
        `Transcript: ${shortPath(getTranscriptPath())}`,
      ]
      const remoteSessionUrl = _context.getAppState().remoteSessionUrl
      if (remoteSessionUrl) {
        lines.push(`Remote session: ${remoteSessionUrl}`)
      }
      onDone(lines.join('\n'), { display: 'system' })
      return null
    }

    if (action === 'list') {
      const [active, archived] = await Promise.all([
        loadAllProjectsMessageLogs(25),
        listArchivedSessions(),
      ])
      const lines = [
        `Resumable conversations: ${active.length}`,
        ...active.slice(0, 25).map(log => {
          const title = log.customTitle || log.summary || log.firstPrompt || '(conversation)'
          return `  ${getSessionIdFromLog(log)}  ${title.replace(/\s+/gu, ' ').slice(0, 80)}`
        }),
        `Archived conversations: ${archived.length}`,
        ...archived.slice(0, 25).map(
          item => `  ${item.sessionId}  archived ${item.archivedAt}`,
        ),
      ]
      onDone(lines.join('\n'), { display: 'system' })
      return null
    }

    if (action === 'archive') {
      const sessionId = sessionIdArg ?? getSessionId()
      if (sessionId === getSessionId()) {
        const transcriptPath = getTranscriptPath()
        onDone(
          `Archiving session ${sessionId} and exiting…\nRestore it later with: ur session unarchive ${sessionId}`,
          { display: 'system' },
        )
        await gracefulShutdown(0, 'prompt_input_exit', {
          finalizeSession: async () => {
            await archiveSession(sessionId, transcriptPath)
          },
          finalMessage: error =>
            error === undefined
              ? `Archived session ${sessionId}.`
              : `Could not archive session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
          skipResumeHint: true,
        })
        return null
      }

      const logs = await loadAllProjectsMessageLogs()
      const log = logs.find(item => getSessionIdFromLog(item) === sessionId)
      if (!log?.fullPath) throw new Error(`Session ${sessionId} was not found`)
      await archiveSession(sessionId, log.fullPath)
      onDone(`Archived session ${sessionId}.`, { display: 'system' })
      return null
    }

    if (action === 'unarchive') {
      if (!sessionIdArg) throw new Error('unarchive requires a session ID')
      const restored = await unarchiveSession(sessionIdArg)
      onDone(
        `Restored session ${restored.sessionId}. Resume it with: ur --resume ${restored.sessionId}`,
        { display: 'system' },
      )
      return null
    }

    onDone(HELP, { display: 'system' })
  } catch (error) {
    onDone(`Session command failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  return null
}
