/**
 * Native Agent Client Protocol (ACP) agent over newline-delimited stdio.
 *
 * The wire layer is owned by the official TypeScript SDK so schema parsing,
 * JSON-RPC concurrency, notification semantics, and error envelopes stay in
 * lockstep with stable ACP protocol version 1. The small legacy handler export
 * remains injectable for focused unit tests; production uses `createAcpApp`.
 */

import * as acp from '@agentclientprotocol/sdk'
import { spawn } from 'node:child_process'
import {
  appendFileSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import { randomUUID } from 'node:crypto'
import { readPositiveInteger } from '../../utils/rollingRateLimiter.js'
import { getURConfigHomeDir } from '../../utils/envUtils.js'

const MAX_STDERR_CHARS = 64 * 1024
const MAX_STREAM_LINE_CHARS = 10 * 1024 * 1024
const DEFAULT_PROMPT_TIMEOUT_MS = 30 * 60 * 1000
const MAX_ADDITIONAL_DIRECTORIES = 32
const MAX_MCP_SERVERS = 32
const MAX_MCP_ARGUMENTS = 256
const MAX_MCP_ENVIRONMENT_VARIABLES = 256
const MAX_MCP_HEADERS = 256
const ACP_SESSION_PAGE_SIZE = 50
const MAX_SESSION_METADATA_BYTES = 32 * 1024
const MAX_SESSION_HISTORY_BYTES = 64 * 1024 * 1024
const MAX_SESSION_HISTORY_EVENTS = 100_000
const MAX_SESSION_HISTORY_EVENT_BYTES = 1024 * 1024
const MAX_SESSION_LIST_SCAN_FILES = 10_000

const ACP_SESSION_MODES = [
  {
    id: 'default',
    name: 'Default',
    description: 'Ask before operations that are not already permitted.',
  },
  {
    id: 'acceptEdits',
    name: 'Accept edits',
    description:
      'Allow ordinary workspace edits while retaining command safeguards.',
  },
  {
    id: 'plan',
    name: 'Plan',
    description: 'Analyze and plan without making implementation changes.',
  },
] as const satisfies readonly acp.SessionMode[]

type AcpSessionModeId = (typeof ACP_SESSION_MODES)[number]['id']

const ACP_AVAILABLE_COMMANDS = [
  {
    name: 'help',
    description: 'Show help and available UR commands.',
  },
  {
    name: 'review',
    description: 'Review a pull request locally.',
    input: { hint: '[pull request number]' },
  },
  {
    name: 'compact',
    description: 'Compact conversation history into a retained summary.',
    input: { hint: '[optional summarization instructions]' },
  },
  {
    name: 'context',
    description: 'Show current context-window usage.',
  },
  {
    name: 'memory',
    description: 'Inspect or edit UR memory files.',
  },
  {
    name: 'skills',
    description: 'List available agent skills.',
  },
  {
    name: 'doctor',
    description: 'Diagnose the UR installation and settings.',
  },
] as const satisfies readonly acp.AvailableCommand[]

type PromptPermissionRequest = Omit<acp.RequestPermissionRequest, 'sessionId'>

type UrPermissionControlRequest = {
  toolName: string
  input: Record<string, unknown>
  toolUseId: string
  title?: string
  permissionSuggestions?: unknown[]
}

export type AcpStdioMessage = {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export type AcpStdioWriter = (message: AcpStdioMessage) => void

export type AcpPromptRunner = (
  prompt: string,
  ctx: {
    sessionId: string
    cwd: string
    signal: AbortSignal
    resumeSessionId?: string
    additionalDirectories: string[]
    mcpServers: acp.McpServer[]
    mode: AcpSessionModeId
    onChunk: (text: string) => void | Promise<void>
    onToolUpdate: (update: acp.SessionUpdate) => void | Promise<void>
    requestPermission: (
      request: PromptPermissionRequest,
    ) => Promise<acp.RequestPermissionResponse>
  },
) => Promise<{ stopReason: acp.StopReason; resumeSessionId?: string }>

type SessionState = {
  cwd: string
  additionalDirectories: string[]
  mcpServers: acp.McpServer[]
  mode: AcpSessionModeId
  streamToolUpdates: boolean
  history: acp.SessionUpdate[]
  title?: string
  createdAt: string
  updatedAt: string
  controller?: AbortController
  activePrompt?: Promise<{
    stopReason: acp.StopReason
    resumeSessionId?: string
  }>
  cliSessionId?: string
}

type PersistedAcpSessionV1 = {
  version: 1
  sessionId: string
  cwd: string
  cliSessionId?: string
  updatedAt: string
}

type PersistedAcpSession = {
  version: 2
  sessionId: string
  cwd: string
  additionalDirectories: string[]
  cliSessionId?: string
  mode: AcpSessionModeId
  streamToolUpdates: boolean
  title?: string
  createdAt: string
  updatedAt: string
}

type PersistedAcpHistoryEvent = {
  version: 1
  update: acp.SessionUpdate
}

function invalidParams(message: string): never {
  throw acp.RequestError.invalidParams(undefined, message)
}

function isExistingDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory()
  } catch {
    return false
  }
}

function validateAdditionalDirectories(
  values: readonly string[] | undefined,
): string[] {
  if (!values) return []
  if (values.length > MAX_ADDITIONAL_DIRECTORIES) {
    invalidParams(
      `additionalDirectories exceeds the ${MAX_ADDITIONAL_DIRECTORIES}-directory limit`,
    )
  }
  const unique = new Set<string>()
  for (const value of values) {
    if (
      typeof value !== 'string' ||
      !isAbsolute(value) ||
      value.includes('\0') ||
      value.length > 4_096 ||
      !isExistingDirectory(value)
    ) {
      invalidParams(
        `additional directory is not an existing absolute directory: ${String(value)}`,
      )
    }
    unique.add(value)
  }
  return [...unique]
}

function validateMcpName(name: unknown): string {
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    name.length > 128 ||
    name.includes('\0')
  ) {
    invalidParams(
      'MCP server names must be non-empty strings of at most 128 characters',
    )
  }
  return name.trim()
}

function validateMcpServers(
  values: readonly acp.McpServer[] | undefined,
): acp.McpServer[] {
  if (!values) return []
  if (values.length > MAX_MCP_SERVERS) {
    invalidParams(`mcpServers exceeds the ${MAX_MCP_SERVERS}-server limit`)
  }
  const names = new Set<string>()
  for (const server of values) {
    if (!server || typeof server !== 'object') {
      invalidParams('every MCP server must be an object')
    }
    const name = validateMcpName(server.name)
    if (names.has(name)) invalidParams(`duplicate MCP server name: ${name}`)
    names.add(name)

    if ('command' in server) {
      if (!Array.isArray(server.args) || !Array.isArray(server.env)) {
        invalidParams(
          `MCP stdio server ${name} must provide args and env arrays`,
        )
      }
      if (
        typeof server.command !== 'string' ||
        !isAbsolute(server.command) ||
        server.command.length > 4_096 ||
        server.command.includes('\0')
      ) {
        invalidParams(
          `MCP stdio command must be an absolute executable path: ${name}`,
        )
      }
      if (server.args.length > MAX_MCP_ARGUMENTS) {
        invalidParams(`MCP server ${name} has too many arguments`)
      }
      if (
        server.args.some(
          (arg) =>
            typeof arg !== 'string' ||
            arg.length > 16_384 ||
            arg.includes('\0'),
        )
      ) {
        invalidParams(`MCP server ${name} has an invalid argument`)
      }
      if (server.env.length > MAX_MCP_ENVIRONMENT_VARIABLES) {
        invalidParams(`MCP server ${name} has too many environment variables`)
      }
      const environmentNames = new Set<string>()
      for (const variable of server.env) {
        if (
          !variable ||
          typeof variable !== 'object' ||
          typeof variable.name !== 'string' ||
          typeof variable.value !== 'string' ||
          !variable.name ||
          variable.name.length > 256 ||
          variable.name.includes('=') ||
          variable.name.includes('\0') ||
          variable.value.length > 1_000_000 ||
          variable.value.includes('\0')
        ) {
          invalidParams(
            `MCP server ${name} has an invalid environment variable`,
          )
        }
        if (environmentNames.has(variable.name)) {
          invalidParams(
            `MCP server ${name} repeats environment variable ${variable.name}`,
          )
        }
        environmentNames.add(variable.name)
      }
      continue
    }

    if (server.type === 'acp') {
      invalidParams(
        `MCP server ${name} uses the unstable ACP transport, which UR does not advertise`,
      )
    }
    if (
      (server.type !== 'http' && server.type !== 'sse') ||
      typeof server.url !== 'string'
    ) {
      invalidParams(`MCP server ${name} uses an unsupported transport`)
    }
    let url: URL
    try {
      url = new URL(server.url)
    } catch {
      invalidParams(`MCP server ${name} has an invalid URL`)
    }
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      server.url.length > 8_192
    ) {
      invalidParams(
        `MCP server ${name} URL must use HTTP(S) and must not contain credentials`,
      )
    }
    if (!Array.isArray(server.headers)) {
      invalidParams(`MCP server ${name} must provide a headers array`)
    }
    if (server.headers.length > MAX_MCP_HEADERS) {
      invalidParams(`MCP server ${name} has too many HTTP headers`)
    }
    const headerNames = new Set<string>()
    for (const header of server.headers) {
      if (
        !header ||
        typeof header !== 'object' ||
        typeof header.name !== 'string' ||
        typeof header.value !== 'string' ||
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,256}$/u.test(header.name) ||
        header.value.length > 64 * 1024 ||
        /[\r\n\0]/u.test(header.value)
      ) {
        invalidParams(`MCP server ${name} has an invalid HTTP header`)
      }
      const normalizedHeader = header.name.toLowerCase()
      if (headerNames.has(normalizedHeader)) {
        invalidParams(`MCP server ${name} repeats HTTP header ${header.name}`)
      }
      headerNames.add(normalizedHeader)
    }
  }
  return [...values]
}

function childMcpConfig(servers: readonly acp.McpServer[]): {
  mcpServers: Record<string, unknown>
} {
  const result: Record<string, unknown> = {}
  for (const server of servers) {
    if ('command' in server) {
      result[server.name] = {
        type: 'stdio',
        command: server.command,
        args: server.args,
        env: Object.fromEntries(
          server.env.map((variable) => [variable.name, variable.value]),
        ),
      }
    } else if (server.type === 'http' || server.type === 'sse') {
      result[server.name] = {
        type: server.type,
        url: server.url,
        headers: Object.fromEntries(
          server.headers.map((header) => [header.name, header.value]),
        ),
      }
    }
  }
  return { mcpServers: result }
}

function createTemporaryMcpConfig(servers: readonly acp.McpServer[]): {
  path?: string
  cleanup: () => void
} {
  if (servers.length === 0) return { cleanup: () => {} }
  const directory = mkdtempSync(join(tmpdir(), 'ur-acp-mcp-'))
  const path = join(directory, 'mcp.json')
  writeFileSync(path, `${JSON.stringify(childMcpConfig(servers))}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  })
  return {
    path,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  }
}

const ACP_SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function persistedSessionPath(sessionId: string, storeRoot: string): string {
  if (!ACP_SESSION_ID_RE.test(sessionId)) {
    invalidParams('sessionId must be a UUID issued by UR')
  }
  return join(storeRoot, 'acp', 'sessions', `${sessionId}.json`)
}

function persistedSessionHistoryPath(
  sessionId: string,
  storeRoot: string,
): string {
  if (!ACP_SESSION_ID_RE.test(sessionId)) {
    invalidParams('sessionId must be a UUID issued by UR')
  }
  return join(storeRoot, 'acp', 'history', `${sessionId}.jsonl`)
}

function isAcpSessionMode(value: unknown): value is AcpSessionModeId {
  return ACP_SESSION_MODES.some((mode) => mode.id === value)
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 20 &&
    value.length <= 40 &&
    Number.isFinite(Date.parse(value))
  )
}

function normalizePersistedSession(
  parsed: unknown,
  expectedSessionId: string,
): PersistedAcpSession {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('metadata is not an object')
  }
  const candidate = parsed as Partial<
    PersistedAcpSession | PersistedAcpSessionV1
  >
  if (
    candidate.sessionId !== expectedSessionId ||
    typeof candidate.cwd !== 'string' ||
    !isAbsolute(candidate.cwd) ||
    candidate.cwd.includes('\0') ||
    candidate.cwd.length > 4_096 ||
    !isIsoTimestamp(candidate.updatedAt) ||
    (candidate.cliSessionId !== undefined &&
      (typeof candidate.cliSessionId !== 'string' ||
        !/^[0-9A-Za-z_-]{1,256}$/u.test(candidate.cliSessionId)))
  ) {
    throw new Error('metadata identity is invalid')
  }

  if (candidate.version === 1) {
    return {
      version: 2,
      sessionId: expectedSessionId,
      cwd: candidate.cwd,
      additionalDirectories: [],
      ...(candidate.cliSessionId
        ? { cliSessionId: candidate.cliSessionId }
        : {}),
      mode: 'default',
      streamToolUpdates: true,
      createdAt: candidate.updatedAt,
      updatedAt: candidate.updatedAt,
    }
  }

  const current = candidate as Partial<PersistedAcpSession>
  if (
    current.version !== 2 ||
    !Array.isArray(current.additionalDirectories) ||
    current.additionalDirectories.length > MAX_ADDITIONAL_DIRECTORIES ||
    current.additionalDirectories.some(
      (directory) =>
        typeof directory !== 'string' ||
        !isAbsolute(directory) ||
        directory.includes('\0') ||
        directory.length > 4_096,
    ) ||
    !isAcpSessionMode(current.mode) ||
    typeof current.streamToolUpdates !== 'boolean' ||
    !isIsoTimestamp(current.createdAt) ||
    (current.title !== undefined &&
      (typeof current.title !== 'string' ||
        !current.title.trim() ||
        current.title.length > 512 ||
        current.title.includes('\0')))
  ) {
    throw new Error('metadata fields are invalid')
  }
  return current as PersistedAcpSession
}

function readPersistedSessionFile(
  sessionId: string,
  storeRoot: string,
): PersistedAcpSession {
  const path = persistedSessionPath(sessionId, storeRoot)
  const file = lstatSync(path)
  if (!file.isFile() || file.isSymbolicLink()) {
    throw new Error('metadata path is not a regular file')
  }
  const size = file.size
  if (size <= 0 || size > MAX_SESSION_METADATA_BYTES) {
    throw new Error('metadata size is invalid')
  }
  return normalizePersistedSession(
    JSON.parse(readFileSync(path, 'utf8')) as unknown,
    sessionId,
  )
}

function persistAcpSession(
  sessionId: string,
  state: SessionState,
  storeRoot: string,
): void {
  const path = persistedSessionPath(sessionId, storeRoot)
  const directory = join(storeRoot, 'acp', 'sessions')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const record: PersistedAcpSession = {
    version: 2,
    sessionId,
    cwd: state.cwd,
    additionalDirectories: state.additionalDirectories,
    ...(state.cliSessionId ? { cliSessionId: state.cliSessionId } : {}),
    mode: state.mode,
    streamToolUpdates: state.streamToolUpdates,
    ...(state.title ? { title: state.title } : {}),
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  }
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    renameSync(temporary, path)
    chmodSync(path, 0o600)
  } finally {
    rmSync(temporary, { force: true })
  }
}

function loadPersistedAcpSession(
  sessionId: string,
  cwd: string,
  storeRoot: string,
): PersistedAcpSession {
  const path = persistedSessionPath(sessionId, storeRoot)
  if (!existsSync(path)) invalidParams(`unknown session: ${sessionId}`)
  let record: PersistedAcpSession
  try {
    record = readPersistedSessionFile(sessionId, storeRoot)
  } catch {
    invalidParams(`session metadata is unreadable: ${sessionId}`)
  }
  if (record.cwd !== cwd) {
    invalidParams(
      `session metadata does not match the requested session and cwd`,
    )
  }
  return record
}

const ACP_SESSION_UPDATE_KINDS = new Set([
  'user_message_chunk',
  'agent_message_chunk',
  'agent_thought_chunk',
  'tool_call',
  'tool_call_update',
  'plan',
  'plan_update',
  'plan_removed',
  'session_info_update',
  'usage_update',
])

function parsePersistedHistoryUpdate(value: unknown): acp.SessionUpdate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('history update is not an object')
  }
  const update = value as { sessionUpdate?: unknown }
  if (
    typeof update.sessionUpdate !== 'string' ||
    !ACP_SESSION_UPDATE_KINDS.has(update.sessionUpdate)
  ) {
    throw new Error('history update kind is invalid')
  }
  return value as acp.SessionUpdate
}

function loadPersistedAcpHistory(
  sessionId: string,
  storeRoot: string,
): acp.SessionUpdate[] {
  const path = persistedSessionHistoryPath(sessionId, storeRoot)
  if (!existsSync(path)) return []
  let size: number
  try {
    const file = lstatSync(path)
    if (!file.isFile() || file.isSymbolicLink()) {
      invalidParams(`session history is unreadable: ${sessionId}`)
    }
    size = file.size
  } catch {
    invalidParams(`session history is unreadable: ${sessionId}`)
  }
  if (size > MAX_SESSION_HISTORY_BYTES) {
    invalidParams(`session history exceeds the supported size: ${sessionId}`)
  }
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean)
  if (lines.length > MAX_SESSION_HISTORY_EVENTS) {
    invalidParams(`session history has too many events: ${sessionId}`)
  }
  try {
    return lines.map((line) => {
      if (line.length > MAX_SESSION_HISTORY_EVENT_BYTES) {
        throw new Error('history event is too large')
      }
      const event = JSON.parse(line) as Partial<PersistedAcpHistoryEvent>
      if (event.version !== 1)
        throw new Error('history event version is invalid')
      return parsePersistedHistoryUpdate(event.update)
    })
  } catch {
    invalidParams(`session history is unreadable: ${sessionId}`)
  }
}

function appendPersistedAcpHistory(
  sessionId: string,
  update: acp.SessionUpdate,
  storeRoot: string,
): void {
  const path = persistedSessionHistoryPath(sessionId, storeRoot)
  const directory = join(storeRoot, 'acp', 'history')
  const line = `${JSON.stringify({
    version: 1,
    update,
  } satisfies PersistedAcpHistoryEvent)}\n`
  if (line.length > MAX_SESSION_HISTORY_EVENT_BYTES) {
    throw new acp.RequestError(
      -32000,
      'ACP session history event is too large to persist',
    )
  }
  let currentSize = 0
  try {
    const file = lstatSync(path)
    if (!file.isFile() || file.isSymbolicLink()) {
      throw new acp.RequestError(
        -32000,
        'ACP session history path is not a regular file',
      )
    }
    currentSize = file.size
  } catch {
    if (existsSync(path))
      throw new acp.RequestError(
        -32000,
        'ACP session history path is not a regular file',
      )
  }
  if (currentSize + Buffer.byteLength(line) > MAX_SESSION_HISTORY_BYTES) {
    throw new acp.RequestError(
      -32000,
      `ACP session history reached the ${MAX_SESSION_HISTORY_BYTES}-byte safety limit`,
    )
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  appendFileSync(path, line, { encoding: 'utf8', mode: 0o600 })
  chmodSync(path, 0o600)
}

function toolKind(name: string): acp.ToolKind {
  const normalized = name.toLowerCase()
  if (/read|cat|view/u.test(normalized)) return 'read'
  if (/edit|write|patch|notebook/u.test(normalized)) return 'edit'
  if (/delete|remove/u.test(normalized)) return 'delete'
  if (/move|rename/u.test(normalized)) return 'move'
  if (/grep|glob|search|find/u.test(normalized)) return 'search'
  if (/bash|shell|powershell|terminal|exec|test/u.test(normalized)) {
    return 'execute'
  }
  if (/fetch|browser|http|api|web/u.test(normalized)) return 'fetch'
  if (/think|plan/u.test(normalized)) return 'think'
  return 'other'
}

function boundedRawValue(value: unknown): unknown | undefined {
  try {
    return JSON.stringify(value).length <= 256_000 ? value : undefined
  } catch {
    return undefined
  }
}

function parsePermissionControlRequest(
  message: unknown,
): UrPermissionControlRequest | undefined {
  if (!message || typeof message !== 'object') return undefined
  const outer = message as { type?: unknown; request?: unknown }
  if (
    outer.type !== 'control_request' ||
    !outer.request ||
    typeof outer.request !== 'object'
  ) {
    return undefined
  }
  const request = outer.request as Record<string, unknown>
  if (request.subtype !== 'can_use_tool') return undefined
  const toolName = request.tool_name
  const toolUseId = request.tool_use_id
  const input = request.input
  if (
    typeof toolName !== 'string' ||
    !toolName ||
    toolName.length > 256 ||
    toolName.includes('\0') ||
    typeof toolUseId !== 'string' ||
    !toolUseId ||
    toolUseId.length > 256 ||
    toolUseId.includes('\0') ||
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input)
  ) {
    return undefined
  }
  const inputRecord = input as Record<string, unknown>
  let serializedInput: string
  try {
    serializedInput = JSON.stringify(inputRecord)
  } catch {
    return undefined
  }
  if (serializedInput.length > 256_000) return undefined
  const titleCandidate = [
    request.title,
    request.display_name,
    request.description,
  ].find((value) => typeof value === 'string' && value.trim())
  return {
    toolName,
    toolUseId,
    input: inputRecord,
    ...(typeof titleCandidate === 'string'
      ? { title: titleCandidate.trim().slice(0, 512) }
      : {}),
    ...(Array.isArray(request.permission_suggestions) &&
    request.permission_suggestions.length <= 100
      ? { permissionSuggestions: request.permission_suggestions }
      : {}),
  }
}

export function acpPermissionRequestFromControl(
  request: UrPermissionControlRequest,
): PromptPermissionRequest {
  const options: acp.PermissionOption[] = [
    { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
  ]
  if (request.permissionSuggestions?.length) {
    options.push({
      optionId: 'allow_always',
      name: 'Always allow',
      kind: 'allow_always',
    })
  }
  options.push({
    optionId: 'reject_once',
    name: 'Reject',
    kind: 'reject_once',
  })
  return {
    toolCall: {
      toolCallId: request.toolUseId,
      title: request.title ?? request.toolName,
      kind: toolKind(request.toolName),
      status: 'pending',
      rawInput: request.input,
    },
    options,
  }
}

export function urPermissionDecisionFromAcp(
  request: UrPermissionControlRequest,
  response: acp.RequestPermissionResponse,
): Record<string, unknown> {
  if (response.outcome.outcome === 'selected') {
    if (response.outcome.optionId === 'allow_once') {
      return {
        behavior: 'allow',
        updatedInput: request.input,
        toolUseID: request.toolUseId,
        decisionClassification: 'user_temporary',
      }
    }
    if (
      response.outcome.optionId === 'allow_always' &&
      request.permissionSuggestions?.length
    ) {
      return {
        behavior: 'allow',
        updatedInput: request.input,
        updatedPermissions: request.permissionSuggestions,
        toolUseID: request.toolUseId,
        decisionClassification: 'user_permanent',
      }
    }
  }
  return {
    behavior: 'deny',
    message:
      response.outcome.outcome === 'cancelled'
        ? 'Permission request was cancelled by the ACP client.'
        : 'Permission request was rejected by the ACP client.',
    toolUseID: request.toolUseId,
    decisionClassification: 'user_reject',
  }
}

function streamToolUpdates(message: unknown): acp.SessionUpdate[] {
  if (!message || typeof message !== 'object') return []
  const envelope = message as {
    type?: unknown
    message?: { content?: unknown }
  }
  const content = envelope.message?.content
  if (!Array.isArray(content)) return []
  const updates: acp.SessionUpdate[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const value = block as Record<string, unknown>
    if (
      envelope.type === 'assistant' &&
      value.type === 'tool_use' &&
      typeof value.id === 'string' &&
      typeof value.name === 'string'
    ) {
      const rawInput = boundedRawValue(value.input)
      updates.push({
        sessionUpdate: 'tool_call',
        toolCallId: value.id,
        title: value.name,
        kind: toolKind(value.name),
        status: 'in_progress',
        ...(rawInput !== undefined ? { rawInput } : {}),
      })
    } else if (
      envelope.type === 'user' &&
      value.type === 'tool_result' &&
      typeof value.tool_use_id === 'string'
    ) {
      const rawOutput = boundedRawValue(value.content)
      updates.push({
        sessionUpdate: 'tool_call_update',
        toolCallId: value.tool_use_id,
        status: value.is_error === true ? 'failed' : 'completed',
        ...(rawOutput !== undefined ? { rawOutput } : {}),
      })
    }
  }
  return updates
}

function extractPromptText(prompt: unknown): string {
  if (typeof prompt === 'string') return prompt
  if (!Array.isArray(prompt)) return ''
  return prompt
    .map((block) => {
      if (typeof block === 'string') return block
      if (!block || typeof block !== 'object') return ''
      const value = block as {
        type?: string
        text?: string
        uri?: string
        name?: string
      }
      if (value.type === 'text' && typeof value.text === 'string') {
        return value.text
      }
      // Resource links are part of ACP's baseline prompt contract. Preserve
      // the reference as explicit model context instead of silently dropping
      // a content block the client is entitled to send.
      if (value.type === 'resource_link' && typeof value.uri === 'string') {
        const label = value.name?.trim() || value.uri
        return `[Referenced resource: ${label}]\n${value.uri}`
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function streamTextDelta(message: unknown): string | undefined {
  if (!message || typeof message !== 'object') return undefined
  const envelope = message as {
    type?: unknown
    event?: {
      type?: unknown
      delta?: { type?: unknown; text?: unknown }
    }
  }
  if (
    envelope.type === 'stream_event' &&
    envelope.event?.type === 'content_block_delta' &&
    envelope.event.delta?.type === 'text_delta' &&
    typeof envelope.event.delta.text === 'string'
  ) {
    return envelope.event.delta.text
  }
  return undefined
}

function streamSessionId(message: unknown): string | undefined {
  if (!message || typeof message !== 'object') return undefined
  const envelope = message as {
    type?: unknown
    subtype?: unknown
    session_id?: unknown
  }
  return envelope.type === 'system' &&
    envelope.subtype === 'init' &&
    typeof envelope.session_id === 'string' &&
    envelope.session_id.length > 0 &&
    envelope.session_id.length <= 256
    ? envelope.session_id
    : undefined
}

/**
 * Run one real UR turn without putting the user prompt or MCP credentials in
 * argv. The bidirectional stream-json transport carries permission decisions
 * between UR's permission engine and the ACP client's native approval UI.
 */
const defaultPromptRunner: AcpPromptRunner = async (prompt, ctx) => {
  if (ctx.signal.aborted) return { stopReason: 'cancelled' }

  const temporaryMcpConfig = createTemporaryMcpConfig(ctx.mcpServers)
  const args = [
    process.argv[1] ?? '',
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-prompt-tool',
    'stdio',
    '--permission-mode',
    ctx.mode,
  ]
  if (ctx.resumeSessionId) {
    args.push('--resume', ctx.resumeSessionId)
  } else {
    args.push('--session-id', ctx.sessionId)
  }
  if (ctx.additionalDirectories.length > 0) {
    args.push('--add-dir', ...ctx.additionalDirectories)
  }
  if (temporaryMcpConfig.path) {
    args.push('--mcp-config', temporaryMcpConfig.path)
  }
  const timeoutMs = readPositiveInteger(
    process.env.UR_ACP_STDIO_PROMPT_TIMEOUT_MS,
    DEFAULT_PROMPT_TIMEOUT_MS,
    2 * 60 * 60 * 1000,
  )
  const maxOutputChars = readPositiveInteger(
    process.env.UR_ACP_STDIO_MAX_OUTPUT_CHARS,
    10 * 1024 * 1024,
    100 * 1024 * 1024,
  )

  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: ctx.cwd,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const decoder = new StringDecoder('utf8')
      let stdoutBuffer = ''
      let stderr = ''
      let outputChars = 0
      let notificationQueue = Promise.resolve()
      let settled = false
      let timedOut = false
      let resumeSessionId = ctx.resumeSessionId
      let killTimer: ReturnType<typeof setTimeout> | undefined

      const queueNotification = (
        operation: () => void | Promise<void>,
      ): void => {
        notificationQueue = notificationQueue.then(operation)
        void notificationQueue.catch(() => {})
      }

      const writeChildMessage = (message: unknown): void => {
        if (settled || child.stdin.destroyed || !child.stdin.writable) return
        child.stdin.write(`${JSON.stringify(message)}\n`)
      }

      const sendControlError = (requestId: string, error: string): void => {
        writeChildMessage({
          type: 'control_response',
          response: {
            subtype: 'error',
            request_id: requestId,
            error,
          },
        })
      }

      const handlePermission = (
        requestId: string,
        request: UrPermissionControlRequest,
      ): void => {
        const task = (async () => {
          const acpRequest = acpPermissionRequestFromControl(request)
          queueNotification(() =>
            ctx.onToolUpdate({
              sessionUpdate: 'tool_call_update',
              toolCallId: request.toolUseId,
              status: 'pending',
            }),
          )
          await notificationQueue

          let decision: Record<string, unknown>
          try {
            const response = await ctx.requestPermission(acpRequest)
            decision = urPermissionDecisionFromAcp(request, response)
          } catch (error) {
            decision = {
              behavior: 'deny',
              message: `ACP permission request failed closed: ${
                error instanceof Error ? error.message : String(error)
              }`,
              toolUseID: request.toolUseId,
              decisionClassification: 'user_reject',
            }
          }

          const allowed = decision.behavior === 'allow'
          queueNotification(() =>
            ctx.onToolUpdate({
              sessionUpdate: 'tool_call_update',
              toolCallId: request.toolUseId,
              status: allowed ? 'in_progress' : 'failed',
            }),
          )
          writeChildMessage({
            type: 'control_response',
            response: {
              subtype: 'success',
              request_id: requestId,
              response: decision,
            },
          })
        })()
        void task.catch((error) => {
          sendControlError(
            requestId,
            `ACP permission bridge failed closed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        })
      }

      const queueChunk = (text: string): void => {
        if (!text || settled) return
        queueNotification(() => ctx.onChunk(text))
      }

      const handleLine = (line: string): void => {
        const trimmed = line.trim()
        if (!trimmed) return
        if (trimmed.length > MAX_STREAM_LINE_CHARS) {
          child.kill('SIGKILL')
          rejectOnce(new Error('ACP prompt emitted an oversized stream event'))
          return
        }
        outputChars += trimmed.length
        if (outputChars > maxOutputChars) {
          child.kill('SIGKILL')
          rejectOnce(
            new Error(
              `ACP prompt output exceeded the ${maxOutputChars}-character limit`,
            ),
          )
          return
        }
        try {
          const message = JSON.parse(trimmed) as unknown
          resumeSessionId = streamSessionId(message) ?? resumeSessionId
          const delta = streamTextDelta(message)
          if (delta) queueChunk(delta)
          for (const update of streamToolUpdates(message)) {
            queueNotification(() => ctx.onToolUpdate(update))
          }

          if (message && typeof message === 'object') {
            const envelope = message as {
              type?: unknown
              request_id?: unknown
              request?: { subtype?: unknown }
            }
            if (envelope.type === 'control_request') {
              if (
                typeof envelope.request_id !== 'string' ||
                !envelope.request_id ||
                envelope.request_id.length > 256
              ) {
                return
              }
              const permission = parsePermissionControlRequest(message)
              if (permission) {
                handlePermission(envelope.request_id, permission)
              } else {
                sendControlError(
                  envelope.request_id,
                  `Unsupported or invalid control request: ${String(
                    envelope.request?.subtype ?? 'unknown',
                  )}`,
                )
              }
            } else if (envelope.type === 'result' && child.stdin.writable) {
              child.stdin.end()
            }
          }
        } catch {
          // stream-json stdout is guarded by the CLI. Treat a stray malformed
          // line as diagnostic noise; the child exit status remains authoritative.
        }
      }

      const consumeStdout = (chunk: Buffer): void => {
        stdoutBuffer += decoder.write(chunk)
        if (stdoutBuffer.length > MAX_STREAM_LINE_CHARS) {
          child.kill('SIGKILL')
          rejectOnce(new Error('ACP prompt emitted an oversized stream event'))
          return
        }
        for (;;) {
          const newline = stdoutBuffer.indexOf('\n')
          if (newline === -1) break
          const line = stdoutBuffer.slice(0, newline)
          stdoutBuffer = stdoutBuffer.slice(newline + 1)
          handleLine(line)
        }
      }

      const cleanup = (): void => {
        clearTimeout(timeout)
        if (killTimer) clearTimeout(killTimer)
        ctx.signal.removeEventListener('abort', abort)
      }

      const rejectOnce = (error: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }

      const abort = (): void => {
        if (settled) return
        child.kill('SIGTERM')
        killTimer = setTimeout(() => child.kill('SIGKILL'), 2_000)
        killTimer.unref?.()
      }

      const timeout = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
        killTimer = setTimeout(() => child.kill('SIGKILL'), 2_000)
        killTimer.unref?.()
      }, timeoutMs)
      timeout.unref?.()

      ctx.signal.addEventListener('abort', abort, { once: true })
      child.stdout.on('data', consumeStdout)
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < MAX_STDERR_CHARS) {
          stderr += chunk
            .toString('utf8')
            .slice(0, MAX_STDERR_CHARS - stderr.length)
        }
      })
      child.stdin.on('error', (error) => {
        if (!ctx.signal.aborted) rejectOnce(error)
      })
      child.on('error', (error) => rejectOnce(error))
      child.on('close', (code, signal) => {
        if (settled) return
        const remainder = stdoutBuffer + decoder.end()
        if (remainder) handleLine(remainder)
        void notificationQueue.then(
          () => {
            if (settled) return
            settled = true
            cleanup()
            if (ctx.signal.aborted) {
              resolve({ stopReason: 'cancelled', resumeSessionId })
              return
            }
            if (timedOut) {
              reject(
                new Error(
                  `ACP prompt exceeded the ${timeoutMs}ms execution timeout`,
                ),
              )
              return
            }
            if (code !== 0) {
              const detail = stderr.trim().slice(0, 2_000)
              reject(
                new Error(
                  detail ||
                    `UR prompt process exited with ${code ?? signal ?? 'an unknown failure'}`,
                ),
              )
              return
            }
            resolve({ stopReason: 'end_turn', resumeSessionId })
          },
          (error) =>
            rejectOnce(
              error instanceof Error ? error : new Error(String(error)),
            ),
        )
      })

      writeChildMessage({
        type: 'control_request',
        request_id: randomUUID(),
        request: { subtype: 'initialize' },
      })
      writeChildMessage({
        type: 'user',
        session_id: '',
        message: { role: 'user', content: prompt },
        parent_tool_use_id: null,
      })
    })
  } finally {
    temporaryMcpConfig.cleanup()
  }
}

function validateSessionCwd(cwd: string): string {
  if (!isAbsolute(cwd)) {
    throw acp.RequestError.invalidParams(
      undefined,
      'cwd must be an absolute path',
    )
  }
  if (!isExistingDirectory(cwd)) {
    throw acp.RequestError.invalidParams(
      undefined,
      `cwd is not an existing directory: ${cwd}`,
    )
  }
  return cwd
}

function createRuntime(deps: {
  cwd: string
  runPrompt?: AcpPromptRunner
  maxSessions?: number
  persistSessions?: boolean
  sessionStoreRoot?: string
}) {
  const sessions = new Map<string, SessionState>()
  const runPrompt = deps.runPrompt ?? defaultPromptRunner
  const shouldPersistSessions = deps.persistSessions !== false
  const sessionStoreRoot = deps.sessionStoreRoot ?? getURConfigHomeDir()
  const maxSessions =
    deps.maxSessions ??
    readPositiveInteger(process.env.UR_ACP_STDIO_MAX_SESSIONS, 100, 1_000)
  const maxPromptChars = readPositiveInteger(
    process.env.UR_ACP_STDIO_MAX_PROMPT_CHARS,
    128_000,
    2_000_000,
  )

  type UpdateClient = {
    onUpdate: (update: acp.SessionUpdate) => void | Promise<void>
  }

  type PromptClient = UpdateClient & {
    requestPermission: (
      request: acp.RequestPermissionRequest,
      signal: AbortSignal,
    ) => Promise<acp.RequestPermissionResponse>
  }

  const modeState = (session: SessionState): acp.SessionModeState => ({
    currentModeId: session.mode,
    availableModes: ACP_SESSION_MODES.map((mode) => ({ ...mode })),
  })

  const configOptions = (session: SessionState): acp.SessionConfigOption[] => [
    {
      type: 'select',
      id: 'tool_updates',
      name: 'Tool updates',
      description:
        'Choose whether ACP receives all tool progress or permission prompts only.',
      category: '_ur',
      currentValue: session.streamToolUpdates ? 'stream' : 'permissions_only',
      options: [
        {
          value: 'stream',
          name: 'Stream all',
          description: 'Report tool starts, progress, and completion.',
        },
        {
          value: 'permissions_only',
          name: 'Permissions only',
          description: 'Suppress non-essential tool progress notifications.',
        },
      ],
    },
  ]

  const availableCommandsUpdate = (): acp.SessionUpdate => ({
    sessionUpdate: 'available_commands_update',
    availableCommands: ACP_AVAILABLE_COMMANDS.map((command) => ({
      ...command,
    })),
  })

  const touch = (sessionId: string, session: SessionState): void => {
    session.updatedAt = new Date().toISOString()
    if (shouldPersistSessions) {
      persistAcpSession(sessionId, session, sessionStoreRoot)
    }
  }

  const recordHistory = (
    sessionId: string,
    session: SessionState,
    update: acp.SessionUpdate,
  ): void => {
    if (session.history.length >= MAX_SESSION_HISTORY_EVENTS) {
      throw new acp.RequestError(
        -32000,
        `ACP session history reached the ${MAX_SESSION_HISTORY_EVENTS}-event safety limit`,
      )
    }
    if (shouldPersistSessions) {
      appendPersistedAcpHistory(sessionId, update, sessionStoreRoot)
    }
    session.history.push(update)
  }

  const stateFromPersisted = (
    persisted: PersistedAcpSession,
    mcpServers: acp.McpServer[],
    additionalDirectories: string[],
  ): SessionState => ({
    cwd: persisted.cwd,
    mcpServers,
    additionalDirectories,
    mode: persisted.mode,
    streamToolUpdates: persisted.streamToolUpdates,
    history: loadPersistedAcpHistory(persisted.sessionId, sessionStoreRoot),
    ...(persisted.title ? { title: persisted.title } : {}),
    createdAt: persisted.createdAt,
    updatedAt: persisted.updatedAt,
    ...(persisted.cliSessionId ? { cliSessionId: persisted.cliSessionId } : {}),
  })

  const sessionInfo = (
    sessionId: string,
    session: SessionState,
  ): acp.SessionInfo => ({
    sessionId,
    cwd: session.cwd,
    additionalDirectories: [...session.additionalDirectories],
    ...(session.title ? { title: session.title } : {}),
    updatedAt: session.updatedAt,
  })

  const persistedSessionInfo = (
    session: PersistedAcpSession,
  ): acp.SessionInfo => ({
    sessionId: session.sessionId,
    cwd: session.cwd,
    additionalDirectories: [...session.additionalDirectories],
    ...(session.title ? { title: session.title } : {}),
    updatedAt: session.updatedAt,
  })

  const announce = (client: UpdateClient): void | Promise<void> =>
    client.onUpdate(availableCommandsUpdate())

  const assertCapacity = (): void => {
    if (sessions.size >= maxSessions) {
      throw new acp.RequestError(
        -32000,
        `ACP session limit reached (${maxSessions}); restart the agent to clear inactive sessions`,
      )
    }
  }

  const newSession = (
    cwd = deps.cwd,
    mcpServers: readonly acp.McpServer[] = [],
    additionalDirectories: readonly string[] = [],
  ): acp.NewSessionResponse => {
    assertCapacity()
    const sessionId = randomUUID()
    const now = new Date().toISOString()
    const state: SessionState = {
      cwd: validateSessionCwd(cwd),
      mcpServers: validateMcpServers(mcpServers),
      additionalDirectories: validateAdditionalDirectories(
        additionalDirectories,
      ),
      mode: 'default',
      streamToolUpdates: true,
      history: [],
      createdAt: now,
      updatedAt: now,
    }
    if (shouldPersistSessions) {
      persistAcpSession(sessionId, state, sessionStoreRoot)
    }
    sessions.set(sessionId, state)
    return {
      sessionId,
      modes: modeState(state),
      configOptions: configOptions(state),
    }
  }

  const resumeSession = (
    sessionId: string,
    cwd: string,
    mcpServers: readonly acp.McpServer[] = [],
    additionalDirectories: readonly string[] = [],
  ): acp.ResumeSessionResponse => {
    const validatedCwd = validateSessionCwd(cwd)
    const validatedMcpServers = validateMcpServers(mcpServers)
    const validatedAdditionalDirectories = validateAdditionalDirectories(
      additionalDirectories,
    )
    const active = sessions.get(sessionId)
    if (active) {
      if (active.cwd !== validatedCwd) {
        invalidParams('session/resume cwd must match the original session cwd')
      }
      if (active.activePrompt) {
        throw new acp.RequestError(
          -32000,
          `session ${sessionId} already has an active prompt`,
        )
      }
      active.mcpServers = validatedMcpServers
      active.additionalDirectories = validatedAdditionalDirectories
      touch(sessionId, active)
      return {
        modes: modeState(active),
        configOptions: configOptions(active),
      }
    }

    assertCapacity()
    if (!shouldPersistSessions) invalidParams(`unknown session: ${sessionId}`)
    const persisted = loadPersistedAcpSession(
      sessionId,
      validatedCwd,
      sessionStoreRoot,
    )
    const state = stateFromPersisted(
      persisted,
      validatedMcpServers,
      validatedAdditionalDirectories,
    )
    sessions.set(sessionId, state)
    touch(sessionId, state)
    return {
      modes: modeState(state),
      configOptions: configOptions(state),
    }
  }

  const loadSession = async (
    sessionId: string,
    cwd: string,
    mcpServers: readonly acp.McpServer[] = [],
    additionalDirectories: readonly string[] = [],
    client: UpdateClient,
  ): Promise<acp.LoadSessionResponse> => {
    const validatedCwd = validateSessionCwd(cwd)
    const validatedMcpServers = validateMcpServers(mcpServers)
    const validatedAdditionalDirectories = validateAdditionalDirectories(
      additionalDirectories,
    )
    let session = sessions.get(sessionId)
    if (session) {
      if (session.cwd !== validatedCwd) {
        invalidParams('session/load cwd must match the original session cwd')
      }
      if (session.activePrompt) {
        throw new acp.RequestError(
          -32000,
          `session ${sessionId} already has an active prompt`,
        )
      }
      session.mcpServers = validatedMcpServers
      session.additionalDirectories = validatedAdditionalDirectories
    } else {
      assertCapacity()
      if (!shouldPersistSessions) invalidParams(`unknown session: ${sessionId}`)
      const persisted = loadPersistedAcpSession(
        sessionId,
        validatedCwd,
        sessionStoreRoot,
      )
      session = stateFromPersisted(
        persisted,
        validatedMcpServers,
        validatedAdditionalDirectories,
      )
      sessions.set(sessionId, session)
    }

    touch(sessionId, session)
    for (const update of session.history) {
      await client.onUpdate(update)
    }
    await announce(client)
    await client.onUpdate({
      sessionUpdate: 'session_info_update',
      ...(session.title ? { title: session.title } : {}),
      updatedAt: session.updatedAt,
    })
    return {
      modes: modeState(session),
      configOptions: configOptions(session),
    }
  }

  const prompt = async (
    sessionId: string,
    content: unknown,
    client: PromptClient,
  ): Promise<{ stopReason: acp.StopReason }> => {
    const session = sessions.get(sessionId)
    if (!session) {
      throw acp.RequestError.invalidParams(
        undefined,
        `unknown session: ${sessionId}`,
      )
    }
    if (session.activePrompt) {
      throw new acp.RequestError(
        -32000,
        `session ${sessionId} already has an active prompt`,
      )
    }
    const text = extractPromptText(content)
    if (!text.trim()) {
      throw acp.RequestError.invalidParams(
        undefined,
        'prompt contains no supported text',
      )
    }
    if (text.length > maxPromptChars || text.includes('\0')) {
      throw acp.RequestError.invalidParams(
        undefined,
        `prompt exceeds the ${maxPromptChars}-character limit or contains a NUL byte`,
      )
    }

    const controller = new AbortController()
    session.controller = controller
    const activePrompt = (async () => {
      if (!session.title) {
        const normalized = text.replace(/\s+/gu, ' ').trim()
        session.title =
          normalized.length <= 80 ? normalized : `${normalized.slice(0, 79)}…`
      }
      session.updatedAt = new Date().toISOString()
      if (shouldPersistSessions) {
        persistAcpSession(sessionId, session, sessionStoreRoot)
      }
      recordHistory(sessionId, session, {
        sessionUpdate: 'user_message_chunk',
        messageId: randomUUID(),
        content: { type: 'text', text },
      })
      await client.onUpdate({
        sessionUpdate: 'session_info_update',
        title: session.title,
        updatedAt: session.updatedAt,
      })

      const agentMessageId = randomUUID()
      const emitAndRecord = async (
        update: acp.SessionUpdate,
      ): Promise<void> => {
        recordHistory(sessionId, session, update)
        await client.onUpdate(update)
      }
      return runPrompt(text, {
        sessionId,
        cwd: session.cwd,
        signal: controller.signal,
        resumeSessionId: session.cliSessionId,
        additionalDirectories: session.additionalDirectories,
        mcpServers: session.mcpServers,
        mode: session.mode,
        onChunk: (chunk) =>
          emitAndRecord({
            sessionUpdate: 'agent_message_chunk',
            messageId: agentMessageId,
            content: { type: 'text', text: chunk },
          }),
        onToolUpdate: async (update) => {
          recordHistory(sessionId, session, update)
          if (session.streamToolUpdates) {
            await client.onUpdate(update)
          }
        },
        requestPermission: (request) =>
          client.requestPermission(
            { sessionId, ...request },
            controller.signal,
          ),
      })
    })()
    session.activePrompt = activePrompt
    try {
      const result = await activePrompt
      if (result.resumeSessionId) {
        session.cliSessionId = result.resumeSessionId
      }
      touch(sessionId, session)
      return {
        stopReason: controller.signal.aborted ? 'cancelled' : result.stopReason,
      }
    } finally {
      if (session.activePrompt === activePrompt) {
        session.activePrompt = undefined
        session.controller = undefined
      }
    }
  }

  const cancel = (sessionId: string): void => {
    sessions.get(sessionId)?.controller?.abort()
  }

  const waitForPromptToStop = async (session: SessionState): Promise<void> => {
    session.controller?.abort()
    const activePrompt = session.activePrompt
    if (!activePrompt) return
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        activePrompt.catch(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 5_000)
          timer.unref?.()
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  const close = async (sessionId: string): Promise<Record<string, never>> => {
    const session = sessions.get(sessionId)
    if (!session) invalidParams(`unknown session: ${sessionId}`)
    await waitForPromptToStop(session)
    sessions.delete(sessionId)
    return {}
  }

  const listSessions = (
    cwd?: string | null,
    cursor?: string | null,
  ): acp.ListSessionsResponse => {
    if (
      cwd !== undefined &&
      cwd !== null &&
      (!isAbsolute(cwd) || cwd.includes('\0') || cwd.length > 4_096)
    ) {
      invalidParams('session/list cwd must be an absolute path')
    }

    const byId = new Map<string, acp.SessionInfo>()
    if (shouldPersistSessions) {
      const directory = join(sessionStoreRoot, 'acp', 'sessions')
      if (existsSync(directory)) {
        const entries = readdirSync(directory, { withFileTypes: true })
        if (entries.length > MAX_SESSION_LIST_SCAN_FILES) {
          throw new acp.RequestError(
            -32000,
            `ACP session store exceeds the ${MAX_SESSION_LIST_SCAN_FILES}-file discovery limit`,
          )
        }
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.json')) continue
          const sessionId = entry.name.slice(0, -'.json'.length)
          if (!ACP_SESSION_ID_RE.test(sessionId)) continue
          try {
            const persisted = readPersistedSessionFile(
              sessionId,
              sessionStoreRoot,
            )
            byId.set(sessionId, persistedSessionInfo(persisted))
          } catch {
            // Corrupt entries are not exposed through discovery. Loading the
            // specific ID still returns a precise protocol error.
          }
        }
      }
    }
    for (const [sessionId, session] of sessions) {
      byId.set(sessionId, sessionInfo(sessionId, session))
    }

    const filtered = [...byId.values()]
      .filter((session) => !cwd || session.cwd === cwd)
      .sort(
        (a, b) =>
          String(b.updatedAt).localeCompare(String(a.updatedAt)) ||
          a.sessionId.localeCompare(b.sessionId),
      )

    let start = 0
    if (cursor) {
      if (cursor.length > 2_048 || !/^[0-9A-Za-z_-]+$/u.test(cursor)) {
        invalidParams('session/list cursor is invalid')
      }
      let decoded: unknown
      try {
        decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
      } catch {
        invalidParams('session/list cursor is invalid')
      }
      const value = decoded as {
        version?: unknown
        cwd?: unknown
        updatedAt?: unknown
        sessionId?: unknown
      }
      if (
        !value ||
        value.version !== 1 ||
        value.cwd !== (cwd ?? null) ||
        !isIsoTimestamp(value.updatedAt) ||
        typeof value.sessionId !== 'string' ||
        !ACP_SESSION_ID_RE.test(value.sessionId)
      ) {
        invalidParams('session/list cursor is invalid')
      }
      const exact = filtered.findIndex(
        (session) =>
          session.updatedAt === value.updatedAt &&
          session.sessionId === value.sessionId,
      )
      if (exact >= 0) {
        start = exact + 1
      } else {
        start = filtered.findIndex(
          (session) =>
            String(session.updatedAt).localeCompare(value.updatedAt as string) <
              0 ||
            (session.updatedAt === value.updatedAt &&
              session.sessionId.localeCompare(value.sessionId as string) > 0),
        )
        if (start < 0) start = filtered.length
      }
    }

    const page = filtered.slice(start, start + ACP_SESSION_PAGE_SIZE)
    const hasMore = start + page.length < filtered.length
    const last = page.at(-1)
    return {
      sessions: page,
      ...(hasMore && last
        ? {
            nextCursor: Buffer.from(
              JSON.stringify({
                version: 1,
                cwd: cwd ?? null,
                updatedAt: last.updatedAt,
                sessionId: last.sessionId,
              }),
            ).toString('base64url'),
          }
        : {}),
    }
  }

  const deleteSession = async (
    sessionId: string,
  ): Promise<Record<string, never>> => {
    const metadataPath = persistedSessionPath(sessionId, sessionStoreRoot)
    const historyPath = persistedSessionHistoryPath(sessionId, sessionStoreRoot)
    const active = sessions.get(sessionId)
    const persisted = shouldPersistSessions && existsSync(metadataPath)
    if (!active && !persisted) invalidParams(`unknown session: ${sessionId}`)
    if (active) {
      await waitForPromptToStop(active)
      sessions.delete(sessionId)
    }
    if (shouldPersistSessions) {
      rmSync(metadataPath, { force: true })
      rmSync(historyPath, { force: true })
    }
    return {}
  }

  const setMode = async (
    sessionId: string,
    modeId: string,
    client: UpdateClient,
  ): Promise<Record<string, never>> => {
    const session = sessions.get(sessionId)
    if (!session) invalidParams(`unknown session: ${sessionId}`)
    if (!isAcpSessionMode(modeId)) {
      invalidParams(`unsupported ACP session mode: ${modeId}`)
    }
    if (session.activePrompt) {
      throw new acp.RequestError(
        -32000,
        'session mode cannot change while a prompt is active',
      )
    }
    session.mode = modeId
    touch(sessionId, session)
    await client.onUpdate({
      sessionUpdate: 'current_mode_update',
      currentModeId: modeId,
    })
    return {}
  }

  const setConfigOption = async (
    request: acp.SetSessionConfigOptionRequest,
    client: UpdateClient,
  ): Promise<acp.SetSessionConfigOptionResponse> => {
    const session = sessions.get(request.sessionId)
    if (!session) invalidParams(`unknown session: ${request.sessionId}`)
    if (request.configId !== 'tool_updates') {
      invalidParams(`unknown ACP session config option: ${request.configId}`)
    }
    if (
      typeof request.value !== 'string' ||
      (request.value !== 'stream' && request.value !== 'permissions_only')
    ) {
      invalidParams('tool_updates must be stream or permissions_only')
    }
    session.streamToolUpdates = request.value === 'stream'
    touch(request.sessionId, session)
    const options = configOptions(session)
    await client.onUpdate({
      sessionUpdate: 'config_option_update',
      configOptions: options,
    })
    return { configOptions: options }
  }

  return {
    sessions,
    announce,
    newSession,
    loadSession,
    listSessions,
    deleteSession,
    resumeSession,
    setMode,
    setConfigOption,
    prompt,
    cancel,
    close,
  }
}

export function createAcpStdioApp(deps: {
  cwd: string
  runPrompt?: AcpPromptRunner
  persistSessions?: boolean
  sessionStoreRoot?: string
}) {
  const runtime = createRuntime(deps)
  const app = acp
    .agent({ name: 'ur-nexus' })
    .onRequest('initialize', () => ({
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        mcpCapabilities: {
          http: true,
          sse: true,
        },
        promptCapabilities: {
          image: false,
          audio: false,
          embeddedContext: false,
        },
        sessionCapabilities: {
          list: {},
          delete: {},
          additionalDirectories: {},
          resume: {},
          close: {},
        },
      },
      authMethods: [],
      agentInfo: { name: 'UR-Nexus', version: MACRO.VERSION },
    }))
    .onRequest('authenticate', () => ({}))
    .onRequest('session/new', async (context) => {
      const result = runtime.newSession(
        context.params.cwd,
        context.params.mcpServers,
        context.params.additionalDirectories,
      )
      await runtime.announce({
        onUpdate: (update) =>
          context.client.notify(acp.methods.client.session.update, {
            sessionId: result.sessionId,
            update,
          }),
      })
      return result
    })
    .onRequest('session/load', (context) =>
      runtime.loadSession(
        context.params.sessionId,
        context.params.cwd,
        context.params.mcpServers,
        context.params.additionalDirectories,
        {
          onUpdate: (update) =>
            context.client.notify(acp.methods.client.session.update, {
              sessionId: context.params.sessionId,
              update,
            }),
        },
      ),
    )
    .onRequest('session/list', (context) =>
      runtime.listSessions(context.params.cwd, context.params.cursor),
    )
    .onRequest('session/delete', (context) =>
      runtime.deleteSession(context.params.sessionId),
    )
    .onRequest('session/resume', async (context) => {
      const result = runtime.resumeSession(
        context.params.sessionId,
        context.params.cwd,
        context.params.mcpServers,
        context.params.additionalDirectories,
      )
      await runtime.announce({
        onUpdate: (update) =>
          context.client.notify(acp.methods.client.session.update, {
            sessionId: context.params.sessionId,
            update,
          }),
      })
      return result
    })
    .onRequest('session/close', (context) =>
      runtime.close(context.params.sessionId),
    )
    .onRequest('session/set_mode', (context) =>
      runtime.setMode(context.params.sessionId, context.params.modeId, {
        onUpdate: (update) =>
          context.client.notify(acp.methods.client.session.update, {
            sessionId: context.params.sessionId,
            update,
          }),
      }),
    )
    .onRequest('session/set_config_option', (context) =>
      runtime.setConfigOption(context.params, {
        onUpdate: (update) =>
          context.client.notify(acp.methods.client.session.update, {
            sessionId: context.params.sessionId,
            update,
          }),
      }),
    )
    .onRequest('session/prompt', (context) =>
      runtime.prompt(context.params.sessionId, context.params.prompt, {
        onUpdate: (update) =>
          context.client.notify(acp.methods.client.session.update, {
            sessionId: context.params.sessionId,
            update,
          }),
        requestPermission: (params, signal) =>
          context.client.request(
            acp.methods.client.session.requestPermission,
            params,
            { cancellationSignal: signal },
          ),
      }),
    )
    .onNotification('session/cancel', (context) => {
      runtime.cancel(context.params.sessionId)
    })

  return { app, sessions: runtime.sessions }
}

/**
 * Small injectable compatibility harness used by unit tests. Production stdio
 * is served through the official SDK below.
 */
export function createAcpStdioAgent(deps: {
  write: AcpStdioWriter
  cwd: string
  runPrompt?: AcpPromptRunner
  requestPermission?: (
    request: acp.RequestPermissionRequest,
  ) => Promise<acp.RequestPermissionResponse>
  persistSessions?: boolean
  sessionStoreRoot?: string
}) {
  const runtime = createRuntime({
    ...deps,
    persistSessions: deps.persistSessions ?? false,
  })
  const respond = (id: AcpStdioMessage['id'], result: unknown): void => {
    if (id !== undefined) deps.write({ jsonrpc: '2.0', id, result })
  }
  const respondError = (id: AcpStdioMessage['id'], error: unknown): void => {
    if (id === undefined) return
    const requestError = error instanceof acp.RequestError ? error : undefined
    deps.write({
      jsonrpc: '2.0',
      id,
      error: {
        code: requestError?.code ?? -32603,
        message: error instanceof Error ? error.message : String(error),
        ...(requestError?.data !== undefined
          ? { data: requestError.data }
          : {}),
      },
    })
  }

  async function handle(message: AcpStdioMessage): Promise<void> {
    const { id, method, params } = message
    if (typeof method !== 'string') return
    try {
      switch (method) {
        case 'initialize':
          respond(id, {
            protocolVersion: acp.PROTOCOL_VERSION,
            agentCapabilities: {
              loadSession: true,
              mcpCapabilities: {
                http: true,
                sse: true,
              },
              promptCapabilities: {
                image: false,
                audio: false,
                embeddedContext: false,
              },
              sessionCapabilities: {
                list: {},
                delete: {},
                additionalDirectories: {},
                resume: {},
                close: {},
              },
            },
            authMethods: [],
            agentInfo: { name: 'UR-Nexus', version: MACRO.VERSION },
          })
          return
        case 'authenticate':
          respond(id, {})
          return
        case 'session/new': {
          const result = runtime.newSession(
            typeof params?.cwd === 'string' ? params.cwd : deps.cwd,
            Array.isArray(params?.mcpServers)
              ? (params.mcpServers as acp.McpServer[])
              : [],
            Array.isArray(params?.additionalDirectories)
              ? (params.additionalDirectories as string[])
              : [],
          )
          respond(id, result)
          await runtime.announce({
            onUpdate: (update) =>
              deps.write({
                jsonrpc: '2.0',
                method: 'session/update',
                params: { sessionId: result.sessionId, update },
              }),
          })
          return
        }
        case 'session/load': {
          const sessionId =
            typeof params?.sessionId === 'string' ? params.sessionId : ''
          const result = await runtime.loadSession(
            sessionId,
            typeof params?.cwd === 'string' ? params.cwd : deps.cwd,
            Array.isArray(params?.mcpServers)
              ? (params.mcpServers as acp.McpServer[])
              : [],
            Array.isArray(params?.additionalDirectories)
              ? (params.additionalDirectories as string[])
              : [],
            {
              onUpdate: (update) =>
                deps.write({
                  jsonrpc: '2.0',
                  method: 'session/update',
                  params: { sessionId, update },
                }),
            },
          )
          respond(id, result)
          return
        }
        case 'session/list':
          respond(
            id,
            runtime.listSessions(
              typeof params?.cwd === 'string' ? params.cwd : undefined,
              typeof params?.cursor === 'string' ? params.cursor : undefined,
            ),
          )
          return
        case 'session/delete':
          respond(
            id,
            await runtime.deleteSession(
              typeof params?.sessionId === 'string' ? params.sessionId : '',
            ),
          )
          return
        case 'session/resume': {
          const sessionId =
            typeof params?.sessionId === 'string' ? params.sessionId : ''
          const result = runtime.resumeSession(
            sessionId,
            typeof params?.cwd === 'string' ? params.cwd : deps.cwd,
            Array.isArray(params?.mcpServers)
              ? (params.mcpServers as acp.McpServer[])
              : [],
            Array.isArray(params?.additionalDirectories)
              ? (params.additionalDirectories as string[])
              : [],
          )
          respond(id, result)
          await runtime.announce({
            onUpdate: (update) =>
              deps.write({
                jsonrpc: '2.0',
                method: 'session/update',
                params: { sessionId, update },
              }),
          })
          return
        }
        case 'session/close':
          respond(
            id,
            await runtime.close(
              typeof params?.sessionId === 'string' ? params.sessionId : '',
            ),
          )
          return
        case 'session/set_mode': {
          const sessionId =
            typeof params?.sessionId === 'string' ? params.sessionId : ''
          respond(
            id,
            await runtime.setMode(
              sessionId,
              typeof params?.modeId === 'string' ? params.modeId : '',
              {
                onUpdate: (update) =>
                  deps.write({
                    jsonrpc: '2.0',
                    method: 'session/update',
                    params: { sessionId, update },
                  }),
              },
            ),
          )
          return
        }
        case 'session/set_config_option': {
          const request = params as unknown as acp.SetSessionConfigOptionRequest
          respond(
            id,
            await runtime.setConfigOption(request, {
              onUpdate: (update) =>
                deps.write({
                  jsonrpc: '2.0',
                  method: 'session/update',
                  params: { sessionId: request.sessionId, update },
                }),
            }),
          )
          return
        }
        case 'session/prompt': {
          const sessionId =
            typeof params?.sessionId === 'string' ? params.sessionId : ''
          const result = await runtime.prompt(sessionId, params?.prompt, {
            onUpdate: (update) =>
              deps.write({
                jsonrpc: '2.0',
                method: 'session/update',
                params: {
                  sessionId,
                  update,
                },
              }),
            requestPermission: (request, _signal) =>
              deps.requestPermission?.(request) ??
              Promise.resolve({ outcome: { outcome: 'cancelled' } }),
          })
          respond(id, result)
          return
        }
        case 'session/cancel':
          runtime.cancel(
            typeof params?.sessionId === 'string' ? params.sessionId : '',
          )
          return
        default:
          if (id !== undefined) {
            throw acp.RequestError.methodNotFound(method)
          }
      }
    } catch (error) {
      respondError(id, error)
    }
  }

  return { handle, sessions: runtime.sessions }
}

export async function startAcpStdioAgent(options: {
  cwd: string
}): Promise<void> {
  const { app } = createAcpStdioApp(options)
  const output = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>
  const input = Readable.toWeb(
    process.stdin,
  ) as unknown as ReadableStream<Uint8Array>
  const connection = app.connect(acp.ndJsonStream(output, input))
  await connection.closed
}
