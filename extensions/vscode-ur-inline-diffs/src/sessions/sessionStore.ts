// File-backed chat session store, persisted under .ur/ide/chat/ — mirrors the
// manifest + per-item-file pattern diffs/store.ts uses for .ur/ide/diffs/.
// Every operation takes `root` explicitly (no vscode import here) so this
// module is usable from pure unit tests without a VS Code host.

import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ChatMessage, ChatSession, ChatSessionRecord } from '../bridge/types.js'
import {
  safeWorkspacePath,
  writeWorkspaceJsonAtomic,
} from '../util/safeWorkspacePath.js'

const SESSION_ID_PATTERN = /^[a-zA-Z0-9-]{1,128}$/
const TITLE_MAX_LENGTH = 60
const DEFAULT_TITLE = 'New Chat'
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024
const MAX_SESSION_BYTES = 64 * 1024 * 1024

interface Manifest {
  version: number
  sessions: ChatSession[]
}

export function chatRoot(root: string): string {
  return path.join(root, '.ur', 'ide', 'chat')
}

function manifestPath(root: string): string {
  return path.join(chatRoot(root), 'manifest.json')
}

function isValidSessionId(id: string): boolean {
  return SESSION_ID_PATTERN.test(id)
}

/** Resolves the on-disk path for a session file and refuses anything that
 * would resolve outside `.ur/ide/chat/sessions/` — defense in depth on top
 * of the id-pattern check above. */
function sessionFilePath(root: string, id: string): string | null {
  if (!isValidSessionId(id)) return null
  const sessionsDir = path.join(chatRoot(root), 'sessions')
  const target = path.join(sessionsDir, `${id}.json`)
  const resolvedDir = path.resolve(sessionsDir) + path.sep
  const resolvedTarget = path.resolve(target)
  if (!resolvedTarget.startsWith(resolvedDir)) return null
  return target
}

function readJson<T>(
  root: string,
  file: string,
  fallback: T,
  maxBytes: number,
): T {
  try {
    const safeFile = safeWorkspacePath(root, file, 'UR chat')
    const size = fs.statSync(safeFile).size
    if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes) {
      return fallback
    }
    return JSON.parse(fs.readFileSync(safeFile, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(root: string, file: string, value: unknown): void {
  writeWorkspaceJsonAtomic(root, file, value, 'UR chat')
}

function readManifest(root: string): Manifest {
  const manifest = readJson<Manifest>(
    root,
    manifestPath(root),
    { version: 1, sessions: [] },
    MAX_MANIFEST_BYTES,
  )
  if (!isRecord(manifest) || !Array.isArray(manifest.sessions)) {
    return { version: 1, sessions: [] }
  }
  const unique = new Map<string, ChatSession>()
  for (const session of manifest.sessions) {
    if (isValidSession(session, root) && !unique.has(session.id)) {
      unique.set(session.id, session)
    }
  }
  return { version: 1, sessions: [...unique.values()] }
}

function writeManifest(root: string, manifest: Manifest): void {
  writeJson(root, manifestPath(root), manifest)
}

function upsertManifestEntry(root: string, session: ChatSession): void {
  const manifest = readManifest(root)
  const index = manifest.sessions.findIndex(entry => entry.id === session.id)
  if (index === -1) {
    manifest.sessions.push(session)
  } else {
    manifest.sessions[index] = session
  }
  writeManifest(root, manifest)
}

export function createSession(root: string, options: { title?: string } = {}): ChatSessionRecord {
  const now = new Date().toISOString()
  const requestedTitle =
    typeof options.title === 'string' ? options.title.trim() : ''
  const session: ChatSession = {
    id: randomUUID(),
    title: requestedTitle
      ? requestedTitle.slice(0, TITLE_MAX_LENGTH)
      : DEFAULT_TITLE,
    workspaceRoot: root,
    createdAt: now,
    updatedAt: now,
  }
  const record: ChatSessionRecord = { session, messages: [] }
  const file = sessionFilePath(root, session.id)
  if (!file) throw new Error(`Generated an invalid session id: ${session.id}`)
  writeJson(root, file, record)
  upsertManifestEntry(root, session)
  return record
}

/** Newest-updated first. */
export function listSessions(root: string, options: { includeArchived?: boolean } = {}): ChatSession[] {
  const manifest = readManifest(root)
  const sessions = options.includeArchived ? manifest.sessions : manifest.sessions.filter(s => !s.archived)
  return sessions.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function readSession(root: string, id: string): ChatSessionRecord | null {
  const file = sessionFilePath(root, id)
  if (!file) return null
  const record = readJson<ChatSessionRecord | null>(
    root,
    file,
    null,
    MAX_SESSION_BYTES,
  )
  return isValidRecord(record, root, id) ? record : null
}

export function appendMessage(root: string, id: string, message: ChatMessage): ChatSessionRecord | null {
  if (!isValidMessage(message, id)) return null
  const record = readSession(root, id)
  if (!record) return null
  record.messages.push(message)
  record.session.updatedAt = new Date().toISOString()
  if (record.session.title === DEFAULT_TITLE && message.role === 'user') {
    record.session.title = deriveTitle(message)
  }
  const file = sessionFilePath(root, id)
  if (!file) return null
  writeJson(root, file, record)
  upsertManifestEntry(root, record.session)
  return record
}

export function setCliSessionId(root: string, id: string, cliSessionId: string): ChatSessionRecord | null {
  if (
    typeof cliSessionId !== 'string' ||
    !cliSessionId ||
    cliSessionId.length > 256 ||
    cliSessionId.includes('\0')
  ) {
    return null
  }
  const record = readSession(root, id)
  if (!record) return null
  record.session.cliSessionId = cliSessionId
  record.session.updatedAt = new Date().toISOString()
  const file = sessionFilePath(root, id)
  if (!file) return null
  writeJson(root, file, record)
  upsertManifestEntry(root, record.session)
  return record
}

export function archiveSession(root: string, id: string): boolean {
  const record = readSession(root, id)
  if (!record) return false
  record.session.archived = true
  record.session.updatedAt = new Date().toISOString()
  const file = sessionFilePath(root, id)
  if (!file) return false
  writeJson(root, file, record)
  upsertManifestEntry(root, record.session)
  return true
}

export function deleteSession(root: string, id: string): boolean {
  const file = sessionFilePath(root, id)
  if (!file) return false
  try {
    safeWorkspacePath(root, file, 'UR chat')
  } catch {
    return false
  }
  const manifest = readManifest(root)
  const index = manifest.sessions.findIndex(entry => entry.id === id)
  if (index === -1 && !fs.existsSync(file)) return false
  if (index !== -1) {
    manifest.sessions.splice(index, 1)
    writeManifest(root, manifest)
  }
  if (fs.existsSync(file)) fs.rmSync(file)
  return true
}

function deriveTitle(message: ChatMessage): string {
  const text = message.content
    .map(block => (block.type === 'text' ? block.text : ''))
    .join(' ')
    .trim()
    .replace(/\s+/g, ' ')
  if (!text) return DEFAULT_TITLE
  return text.length > TITLE_MAX_LENGTH ? `${text.slice(0, TITLE_MAX_LENGTH - 1)}…` : text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isValidSession(value: unknown, root: string): value is ChatSession {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    isValidSessionId(value.id) &&
    typeof value.title === 'string' &&
    value.title.length > 0 &&
    value.title.length <= TITLE_MAX_LENGTH &&
    typeof value.workspaceRoot === 'string' &&
    path.resolve(value.workspaceRoot) === path.resolve(root) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    (value.cliSessionId === undefined ||
      (typeof value.cliSessionId === 'string' &&
        value.cliSessionId.length > 0 &&
        value.cliSessionId.length <= 256 &&
        !value.cliSessionId.includes('\0'))) &&
    (value.archived === undefined || typeof value.archived === 'boolean')
  )
}

function isValidRecord(
  value: unknown,
  root: string,
  id: string,
): value is ChatSessionRecord {
  if (!isRecord(value) || !isValidSession(value.session, root)) return false
  if (value.session.id !== id || !Array.isArray(value.messages)) return false
  return value.messages.every(message => isValidMessage(message, id))
}

function isValidMessage(value: unknown, sessionId: string): value is ChatMessage {
  if (!isRecord(value)) return false
  if (
    typeof value.id !== 'string' ||
    !value.id ||
    value.id.length > 256 ||
    value.sessionId !== sessionId ||
    (value.role !== 'user' &&
      value.role !== 'assistant' &&
      value.role !== 'status') ||
    typeof value.createdAt !== 'string' ||
    !Array.isArray(value.content)
  ) {
    return false
  }
  return value.content.every(isValidContentBlock)
}

function isValidContentBlock(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  if (value.type === 'text') return typeof value.text === 'string'
  if (value.type === 'tool_use') {
    return (
      typeof value.id === 'string' &&
      typeof value.name === 'string' &&
      'input' in value
    )
  }
  if (value.type === 'tool_result') {
    return (
      typeof value.toolUseId === 'string' &&
      typeof value.ok === 'boolean' &&
      typeof value.summary === 'string'
    )
  }
  if (value.type === 'permission_request') {
    return (
      typeof value.requestId === 'string' &&
      typeof value.toolName === 'string' &&
      (value.resolved === undefined ||
        value.resolved === 'allow' ||
        value.resolved === 'deny')
    )
  }
  return false
}
