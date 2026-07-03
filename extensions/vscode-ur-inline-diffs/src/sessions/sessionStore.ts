// File-backed chat session store, persisted under .ur/ide/chat/ — mirrors the
// manifest + per-item-file pattern diffs/store.ts uses for .ur/ide/diffs/.
// Every operation takes `root` explicitly (no vscode import here) so this
// module is usable from pure unit tests without a VS Code host.

import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ChatMessage, ChatSession, ChatSessionRecord } from '../bridge/types.js'

const SESSION_ID_PATTERN = /^[a-zA-Z0-9-]{1,128}$/
const TITLE_MAX_LENGTH = 60
const DEFAULT_TITLE = 'New Chat'

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

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function readManifest(root: string): Manifest {
  const manifest = readJson<Manifest>(manifestPath(root), { version: 1, sessions: [] })
  return Array.isArray(manifest.sessions) ? manifest : { version: 1, sessions: [] }
}

function writeManifest(root: string, manifest: Manifest): void {
  writeJson(manifestPath(root), manifest)
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
  const session: ChatSession = {
    id: randomUUID(),
    title: options.title?.trim() || DEFAULT_TITLE,
    workspaceRoot: root,
    createdAt: now,
    updatedAt: now,
  }
  const record: ChatSessionRecord = { session, messages: [] }
  const file = sessionFilePath(root, session.id)
  if (!file) throw new Error(`Generated an invalid session id: ${session.id}`)
  writeJson(file, record)
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
  if (!file || !fs.existsSync(file)) return null
  return readJson<ChatSessionRecord | null>(file, null)
}

export function appendMessage(root: string, id: string, message: ChatMessage): ChatSessionRecord | null {
  const record = readSession(root, id)
  if (!record) return null
  record.messages.push(message)
  record.session.updatedAt = new Date().toISOString()
  if (record.session.title === DEFAULT_TITLE && message.role === 'user') {
    record.session.title = deriveTitle(message)
  }
  const file = sessionFilePath(root, id)
  if (!file) return null
  writeJson(file, record)
  upsertManifestEntry(root, record.session)
  return record
}

export function setCliSessionId(root: string, id: string, cliSessionId: string): ChatSessionRecord | null {
  const record = readSession(root, id)
  if (!record) return null
  record.session.cliSessionId = cliSessionId
  record.session.updatedAt = new Date().toISOString()
  const file = sessionFilePath(root, id)
  if (!file) return null
  writeJson(file, record)
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
  writeJson(file, record)
  upsertManifestEntry(root, record.session)
  return true
}

export function deleteSession(root: string, id: string): boolean {
  const file = sessionFilePath(root, id)
  if (!file) return false
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
