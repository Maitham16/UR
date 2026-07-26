import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  getOriginalCwd,
  getSessionProjectDir,
} from '../../bootstrap/state.js'
import type { NonNullableUsage } from '../api/logging.js'
import { getProjectDir } from '../../utils/sessionStorage.js'
import {
  ensurePrivateDirectory,
  readPrivateText,
  withPrivateStateLock,
  writePrivateTextAtomic,
} from '../../utils/privateState.js'
import { safeParseJSON } from '../../utils/json.js'

export type SideChatStatus = 'open' | 'closed'

export type SideChatTurn = {
  version: 1
  id: string
  role: 'user' | 'assistant'
  content: string
  at: string
  previousDigest: string
  digest: string
  usage?: Partial<NonNullableUsage>
}

export type SideChat = {
  version: 1
  id: string
  title: string
  status: SideChatStatus
  parentSessionId: string
  parentMessageId?: string
  createdAt: string
  updatedAt: string
  turnCount: number
  headDigest: string
  turns: SideChatTurn[]
}

export type SideChatSummary = Omit<SideChat, 'turns'>

const STORE_MAX_BYTES = 8 * 1024 * 1024
const MAX_TURNS = 200
const MAX_CONTENT_BYTES = 64 * 1024
const MAX_CHATS = 500
const ID_RE = /^[a-zA-Z0-9._-]{1,200}$/
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/
const GENESIS = `sha256:${createHash('sha256')
  .update('ur-side-chat-genesis-v1')
  .digest('hex')}`

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function sideChatsRoot(root?: string): string {
  if (root) return root
  const projectDir = getSessionProjectDir() ?? getProjectDir(getOriginalCwd())
  return join(projectDir, 'side-chats')
}

function chatPath(root: string, id: string): string {
  if (!ID_RE.test(id)) throw new Error('Invalid side-chat id')
  return join(root, `${id}.json`)
}

function turnDigest(turn: Omit<SideChatTurn, 'digest'>): string {
  return digest(`ur-side-chat-turn-v1\n${stableJson(turn)}\n`)
}

function validateTurn(
  value: unknown,
  expectedPrevious: string,
): value is SideChatTurn {
  if (!value || typeof value !== 'object') return false
  const turn = value as SideChatTurn
  if (
    turn.version !== 1 ||
    !ID_RE.test(turn.id) ||
    !['user', 'assistant'].includes(turn.role) ||
    typeof turn.content !== 'string' ||
    Buffer.byteLength(turn.content) > MAX_CONTENT_BYTES ||
    !Number.isFinite(Date.parse(turn.at)) ||
    turn.previousDigest !== expectedPrevious ||
    !DIGEST_RE.test(turn.digest)
  ) {
    return false
  }
  const { digest: _digest, ...unsigned } = turn
  return turn.digest === turnDigest(unsigned)
}

function validateChat(value: unknown): value is SideChat {
  if (!value || typeof value !== 'object') return false
  const chat = value as SideChat
  if (
    chat.version !== 1 ||
    !ID_RE.test(chat.id) ||
    typeof chat.title !== 'string' ||
    chat.title.length === 0 ||
    chat.title.length > 200 ||
    !['open', 'closed'].includes(chat.status) ||
    !ID_RE.test(chat.parentSessionId) ||
    (chat.parentMessageId !== undefined && !ID_RE.test(chat.parentMessageId)) ||
    !Number.isFinite(Date.parse(chat.createdAt)) ||
    !Number.isFinite(Date.parse(chat.updatedAt)) ||
    !Array.isArray(chat.turns) ||
    chat.turns.length > MAX_TURNS ||
    chat.turnCount !== chat.turns.length
  ) {
    return false
  }
  let head = GENESIS
  for (const turn of chat.turns) {
    if (!validateTurn(turn, head)) return false
    head = turn.digest
  }
  return chat.headDigest === head
}

function load(root: string, id: string): SideChat {
  const raw = readPrivateText(root, chatPath(root, id), STORE_MAX_BYTES)
  if (raw === null) throw new Error(`Side chat not found: ${id}`)
  const value = safeParseJSON(raw, false)
  if (!validateChat(value)) {
    throw new Error(`Side chat failed integrity validation: ${id}`)
  }
  return value
}

function save(root: string, chat: SideChat): void {
  if (!validateChat(chat)) throw new Error('Refusing to save an invalid side chat')
  writePrivateTextAtomic(
    root,
    chatPath(root, chat.id),
    `${JSON.stringify(chat, null, 2)}\n`,
    STORE_MAX_BYTES,
  )
}

export function createSideChat(input: {
  title: string
  parentSessionId: string
  parentMessageId?: string
  root?: string
}): SideChat {
  const root = sideChatsRoot(input.root)
  if (!ID_RE.test(input.parentSessionId)) throw new Error('Invalid parent session id')
  if (input.parentMessageId && !ID_RE.test(input.parentMessageId)) {
    throw new Error('Invalid parent message id')
  }
  const title = input.title.trim().replace(/\s+/g, ' ').slice(0, 200)
  if (!title) throw new Error('Side-chat title must not be empty')
  ensurePrivateDirectory(root, root)
  return withPrivateStateLock(root, 'index', () => {
    const count = readdirSync(root).filter(name => name.endsWith('.json')).length
    if (count >= MAX_CHATS) {
      throw new Error(`Side-chat storage is limited to ${MAX_CHATS} chats`)
    }
    const now = new Date().toISOString()
    const chat: SideChat = {
      version: 1,
      id: randomUUID(),
      title,
      status: 'open',
      parentSessionId: input.parentSessionId,
      parentMessageId: input.parentMessageId,
      createdAt: now,
      updatedAt: now,
      turnCount: 0,
      headDigest: GENESIS,
      turns: [],
    }
    save(root, chat)
    return structuredClone(chat)
  })
}

export function getSideChat(id: string, rootOverride?: string): SideChat {
  return structuredClone(load(sideChatsRoot(rootOverride), id))
}

export function listSideChats(
  options: { status?: SideChatStatus; root?: string } = {},
): SideChatSummary[] {
  const root = sideChatsRoot(options.root)
  if (!existsSync(root)) return []
  const rootStat = lstatSync(root)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('Side-chat storage root is unsafe')
  }
  const summaries: SideChatSummary[] = []
  for (const name of readdirSync(root).sort()) {
    if (!name.endsWith('.json')) continue
    const path = join(root, name)
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('Side-chat storage contains an unsafe entry')
    }
    const chat = load(root, name.slice(0, -5))
    if (options.status && chat.status !== options.status) continue
    const { turns: _turns, ...summary } = chat
    summaries.push(summary)
  }
  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function appendSideChatTurn(
  id: string,
  role: SideChatTurn['role'],
  content: string,
  options: { usage?: Partial<NonNullableUsage>; root?: string } = {},
): SideChat {
  const root = sideChatsRoot(options.root)
  if (!['user', 'assistant'].includes(role)) throw new Error('Invalid side-chat role')
  if (!content.trim()) throw new Error('Side-chat turn must not be empty')
  if (Buffer.byteLength(content) > MAX_CONTENT_BYTES) {
    throw new Error('Side-chat turn exceeds the 64 KiB safety limit')
  }
  ensurePrivateDirectory(root, root)
  return withPrivateStateLock(root, `chat-${id}`, () => {
    const chat = load(root, id)
    if (chat.status !== 'open') throw new Error('Side chat is closed')
    if (chat.turns.length >= MAX_TURNS) {
      throw new Error(`Side chat is limited to ${MAX_TURNS} turns`)
    }
    const unsigned: Omit<SideChatTurn, 'digest'> = {
      version: 1,
      id: randomUUID(),
      role,
      content,
      at: new Date().toISOString(),
      previousDigest: chat.headDigest,
      usage: options.usage,
    }
    const turn: SideChatTurn = { ...unsigned, digest: turnDigest(unsigned) }
    chat.turns.push(turn)
    chat.turnCount = chat.turns.length
    chat.headDigest = turn.digest
    chat.updatedAt = turn.at
    save(root, chat)
    return structuredClone(chat)
  })
}

function validateExchangeContent(label: string, content: string): void {
  if (!content.trim()) throw new Error(`${label} side-chat turn must not be empty`)
  if (Buffer.byteLength(content) > MAX_CONTENT_BYTES) {
    throw new Error(`${label} side-chat turn exceeds the 64 KiB safety limit`)
  }
}

export function assertSideChatExchangeCapacity(
  id: string,
  rootOverride?: string,
): void {
  const root = sideChatsRoot(rootOverride)
  ensurePrivateDirectory(root, root)
  withPrivateStateLock(root, `chat-${id}`, () => {
    const chat = load(root, id)
    if (chat.status !== 'open') throw new Error('Side chat is closed')
    if (chat.turns.length > MAX_TURNS - 2) {
      throw new Error(
        `Side chat needs two free turns for a complete exchange (${MAX_TURNS} maximum)`,
      )
    }
  })
}

/** Persist a user question and its answer in one integrity-chain transaction. */
export function appendSideChatExchange(
  id: string,
  userContent: string,
  assistantContent: string,
  options: { usage?: Partial<NonNullableUsage>; root?: string } = {},
): SideChat {
  validateExchangeContent('User', userContent)
  validateExchangeContent('Assistant', assistantContent)
  const root = sideChatsRoot(options.root)
  ensurePrivateDirectory(root, root)
  return withPrivateStateLock(root, `chat-${id}`, () => {
    const chat = load(root, id)
    if (chat.status !== 'open') throw new Error('Side chat is closed')
    if (chat.turns.length > MAX_TURNS - 2) {
      throw new Error(
        `Side chat needs two free turns for a complete exchange (${MAX_TURNS} maximum)`,
      )
    }
    for (const [role, content, usage] of [
      ['user', userContent, undefined],
      ['assistant', assistantContent, options.usage],
    ] as const) {
      const unsigned: Omit<SideChatTurn, 'digest'> = {
        version: 1,
        id: randomUUID(),
        role,
        content,
        at: new Date().toISOString(),
        previousDigest: chat.headDigest,
        usage,
      }
      const turn: SideChatTurn = { ...unsigned, digest: turnDigest(unsigned) }
      chat.turns.push(turn)
      chat.headDigest = turn.digest
      chat.updatedAt = turn.at
    }
    chat.turnCount = chat.turns.length
    save(root, chat)
    return structuredClone(chat)
  })
}

function mutateSideChat(
  id: string,
  rootOverride: string | undefined,
  mutate: (chat: SideChat) => void,
): SideChat {
  const root = sideChatsRoot(rootOverride)
  ensurePrivateDirectory(root, root)
  return withPrivateStateLock(root, `chat-${id}`, () => {
    const chat = load(root, id)
    mutate(chat)
    chat.updatedAt = new Date().toISOString()
    save(root, chat)
    return structuredClone(chat)
  })
}

export function renameSideChat(
  id: string,
  title: string,
  rootOverride?: string,
): SideChat {
  const normalized = title.trim().replace(/\s+/g, ' ').slice(0, 200)
  if (!normalized) throw new Error('Side-chat title must not be empty')
  return mutateSideChat(id, rootOverride, chat => {
    chat.title = normalized
  })
}

export function closeSideChat(
  id: string,
  rootOverride?: string,
): SideChat {
  return mutateSideChat(id, rootOverride, chat => {
    chat.status = 'closed'
  })
}
