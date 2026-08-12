/* eslint-disable custom-rules/no-process-exit -- CLI subcommand handlers intentionally exit */

import { writeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { LogOption } from '../../types/logs.js'
import {
  type ArchivedSession,
  listArchivedSessions,
} from '../../utils/sessionArchive.js'
import {
  getSessionIdFromLog,
  loadAllProjectsMessageLogs,
} from '../../utils/sessionStorage.js'

export type CliSessionStatus = {
  sessionId: string
  status: 'resumable' | 'archived'
  title: string | null
  projectPath: string | null
  storagePath: string | null
  transcriptPath: string
  createdAt: string | null
  modifiedAt: string | null
  archivedAt: string | null
}

function activeStatus(log: LogOption): CliSessionStatus | undefined {
  const sessionId = getSessionIdFromLog(log)
  if (!sessionId || !log.projectPath || !log.fullPath) return undefined
  return {
    sessionId,
    status: 'resumable',
    title: log.customTitle || log.summary || log.firstPrompt || null,
    projectPath: log.projectPath,
    storagePath: null,
    transcriptPath: log.fullPath,
    createdAt: log.created.toISOString(),
    modifiedAt: log.modified.toISOString(),
    archivedAt: null,
  }
}

function archivedStatus(session: ArchivedSession): CliSessionStatus {
  return {
    sessionId: session.sessionId,
    status: 'archived',
    title: null,
    projectPath: null,
    storagePath: join(session.projectDir, '.session-archive', session.sessionId),
    transcriptPath: join(
      session.projectDir,
      '.session-archive',
      session.sessionId,
      'transcript.jsonl',
    ),
    createdAt: null,
    modifiedAt: null,
    archivedAt: session.archivedAt,
  }
}

export function selectCliSessionStatus(
  active: LogOption[],
  archived: ArchivedSession[],
  sessionId: string | undefined,
  cwd: string,
): CliSessionStatus | undefined {
  if (sessionId) {
    const activeMatch = active.find(log => getSessionIdFromLog(log) === sessionId)
    if (activeMatch) return activeStatus(activeMatch)
    const archivedMatch = archived.find(item => item.sessionId === sessionId)
    return archivedMatch ? archivedStatus(archivedMatch) : undefined
  }

  const projectRoot = resolve(cwd)
  const latest = active.find(
    log => log.projectPath && resolve(log.projectPath) === projectRoot,
  )
  return latest ? activeStatus(latest) : undefined
}

function writeOutput(text: string): void {
  /* eslint-disable-next-line custom-rules/no-sync-fs -- process exits immediately */
  writeSync(1, text.endsWith('\n') ? text : `${text}\n`)
}

function writeError(text: string): void {
  /* eslint-disable-next-line custom-rules/no-sync-fs -- process exits immediately */
  writeSync(2, text.endsWith('\n') ? text : `${text}\n`)
}

function formatSessionStatus(status: CliSessionStatus): string {
  const lines = [
    `Session: ${status.sessionId}`,
    `Status: ${status.status}`,
  ]
  if (status.projectPath) lines.push(`Project: ${status.projectPath}`)
  if (status.storagePath) lines.push(`Archive storage: ${status.storagePath}`)
  lines.push(`Transcript: ${status.transcriptPath}`)
  if (status.title) lines.push(`Title: ${status.title.replace(/\s+/gu, ' ').slice(0, 120)}`)
  if (status.modifiedAt) lines.push(`Last updated: ${status.modifiedAt}`)
  if (status.archivedAt) lines.push(`Archived: ${status.archivedAt}`)
  return lines.join('\n')
}

export async function sessionStatusHandler(
  sessionId: string | undefined,
  options: { json?: boolean } = {},
): Promise<void> {
  const [active, archived] = await Promise.all([
    loadAllProjectsMessageLogs(),
    listArchivedSessions(),
  ])
  const status = selectCliSessionStatus(
    active,
    archived,
    sessionId,
    process.cwd(),
  )
  if (!status) {
    writeError(
      sessionId
        ? `Session ${sessionId} was not found.`
        : 'No resumable session was found for the current project. Run "ur session list" to inspect all sessions.',
    )
    process.exit(1)
  }
  writeOutput(options.json ? JSON.stringify(status, null, 2) : formatSessionStatus(status))
  process.exit(0)
}
