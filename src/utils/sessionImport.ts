import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import {
  getTranscriptPathForSession,
  MAX_TRANSCRIPT_READ_BYTES,
  sessionIdExists,
} from './sessionStorage.js'

// Anything larger could be imported but never resumed: readers bail above
// MAX_TRANSCRIPT_READ_BYTES, so accepting more would create dead sessions.
const MAX_IMPORT_BYTES = MAX_TRANSCRIPT_READ_BYTES

export type SessionImportValidation = {
  valid: boolean
  errors: string[]
  messageCount: number
}

/**
 * Validate that a file is a UR transcript: newline-delimited JSON objects
 * where at least one entry is a typed message. Rejects rather than repairs —
 * an import that silently drops lines would corrupt /resume history.
 */
export function validateTranscriptContent(
  content: string,
): SessionImportValidation {
  const errors: string[] = []
  let messageCount = 0
  const lines = content.split('\n').filter(line => line.trim())
  if (lines.length === 0) {
    return { valid: false, errors: ['file contains no entries'], messageCount }
  }
  for (const [index, line] of lines.entries()) {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      errors.push(`line ${index + 1} is not valid JSON`)
      if (errors.length >= 5) {
        errors.push('…stopping after 5 errors')
        break
      }
      continue
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      errors.push(`line ${index + 1} is not a JSON object`)
      continue
    }
    if (typeof (parsed as { type?: unknown }).type === 'string') {
      messageCount++
    }
  }
  if (messageCount === 0) {
    errors.push('no typed transcript entries found; not a UR session file')
  }
  return { valid: errors.length === 0, errors, messageCount }
}

export type SessionImportResult = {
  sessionId: string
  path: string
  messageCount: number
}

/**
 * Import a transcript exported from another machine into this project's
 * session store under a fresh session id, so `ur -r <id>` can resume it.
 * The source file is validated in full before anything is written.
 */
export function importSessionFile(sourcePath: string): SessionImportResult {
  const source = isAbsolute(sourcePath) ? sourcePath : resolve(sourcePath)
  if (!existsSync(source)) {
    throw new Error(`No such file: ${source}`)
  }
  const stat = statSync(source)
  if (!stat.isFile()) {
    throw new Error(`Not a regular file: ${source}`)
  }
  if (stat.size > MAX_IMPORT_BYTES) {
    throw new Error(
      `Refusing to import ${stat.size} bytes (limit ${MAX_IMPORT_BYTES})`,
    )
  }
  const validation = validateTranscriptContent(readFileSync(source, 'utf8'))
  if (!validation.valid) {
    throw new Error(`Invalid session file:\n- ${validation.errors.join('\n- ')}`)
  }
  // Fresh id: imported sessions must never collide with or overwrite local
  // history, even when the same export is imported twice.
  let sessionId = randomUUID()
  while (sessionIdExists(sessionId)) sessionId = randomUUID()
  const target = getTranscriptPathForSession(sessionId)
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(source, target)
  return { sessionId, path: target, messageCount: validation.messageCount }
}
