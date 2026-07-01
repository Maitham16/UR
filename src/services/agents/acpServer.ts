import { randomUUID } from 'node:crypto'
import { getDefaultAppState } from 'src/state/AppStateStore.js'
import type { Command } from '../../commands.js'
import {
  findToolByName,
  getEmptyToolPermissionContext,
  type ToolUseContext,
  type ValidationResult,
} from '../../Tool.js'
import { createAssistantMessage } from '../../utils/messages.js'
import { hasPermissionsToUseTool } from '../../utils/permissions/permissions.js'
import { getTools } from '../../tools.js'
import { createAbortController } from '../../utils/abortController.js'
import { createFileStateCacheWithSizeLimit } from '../../utils/fileStateCache.js'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { getErrnoCode } from '../../utils/errors.js'
import { getMainLoopModel } from '../../utils/model/model.js'
import { logError } from '../../utils/log.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { getErrorParts } from '../../utils/toolErrors.js'
import { zodToJsonSchema } from '../../utils/zodToJsonSchema.js'
import {
  createIdeDiffBundle,
  getIdeDiffBundle,
  readIdeDiffPatch,
} from './ideDiffs.js'
import {
  getBackgroundTask,
  listBackgroundTasks,
  readBackgroundLog,
  startBackgroundTask,
  stopBackgroundTask,
  type BackgroundTask,
} from './backgroundRunner.js'
import {
  authorizeRequest,
  type AuthResult,
} from './a2aServer.js'
import type {
  AcpResponse,
  AcpServeOptions,
  AcpTaskRecord,
  AcpTaskStatus,
} from './acpTypes.js'

const MCP_COMMANDS: Command[] = []
const acpTasks = new Map<string, AcpTaskRecord>()

function jsonResponse(status: number, body: AcpResponse | { error: string }): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function rpcResponse(id: string | number | null, result?: unknown, error?: AcpResponse['error']): AcpResponse {
  if (error) {
    return { jsonrpc: '2.0', id, error }
  }
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id: string | number | null, code: number, message: string, data?: unknown): AcpResponse {
  return { jsonrpc: '2.0', id, error: { code, message, data } }
}

function createAcpId(): string {
  return `acp_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`
}

function now(): string {
  return new Date().toISOString()
}

function acpDir(cwd: string): string {
  return `${cwd}/.ur/acp`
}

function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

function authorizeAcp(request: Request, options: AcpServeOptions): AuthResult {
  return authorizeRequest(request, { token: options.token })
}

function mapBackgroundStatus(status: BackgroundTask['status']): AcpTaskStatus {
  switch (status) {
    case 'queued':
      return 'submitted'
    case 'running':
      return 'working'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'canceled':
      return 'canceled'
  }
}

function buildToolUseContext(tools: ReturnType<typeof getTools>, readFileStateCache: ReturnType<typeof createFileStateCacheWithSizeLimit>): ToolUseContext {
  return {
    abortController: createAbortController(),
    options: {
      commands: MCP_COMMANDS,
      tools,
      mainLoopModel: getMainLoopModel(),
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: true,
      debug: false,
      verbose: false,
      agentDefinitions: { activeAgents: [], allAgents: [] },
    },
    getAppState: () => getDefaultAppState(),
    setAppState: () => {},
    messages: [],
    readFileState: readFileStateCache,
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
  }
}

async function handleInitialize(options: AcpServeOptions): Promise<unknown> {
  return {
    name: 'ur-agent',
    version: MACRO.VERSION,
    protocolVersion: '0.1.0',
    workspaceRoot: options.cwd,
    capabilities: {
      tools: true,
      tasks: true,
      sessions: true,
      ide: true,
      streaming: false,
      cancellation: true,
    },
  }
}

const acpSessions = new Map<string, { id: string; cwd: string; createdAt: string }>()

async function handleSessionNew(
  params: Record<string, unknown> | undefined,
  options: AcpServeOptions,
): Promise<unknown> {
  const cwd = typeof params?.cwd === 'string' ? params.cwd : options.cwd
  const session = { id: `sess_${randomUUID()}`, cwd, createdAt: now() }
  acpSessions.set(session.id, session)
  return { sessionId: session.id, workspaceRoot: session.cwd }
}

async function handleSessionPrompt(
  params: Record<string, unknown> | undefined,
  options: AcpServeOptions,
): Promise<unknown> {
  const sessionId = typeof params?.sessionId === 'string' ? params.sessionId : undefined
  if (sessionId && !acpSessions.has(sessionId)) {
    throw new Error(`unknown session: ${sessionId}`)
  }
  const sent = (await handleTasksSend(params, options)) as { task: AcpTaskRecord }
  return { sessionId: sessionId ?? null, ...sent }
}

async function handleSessionCancel(
  params: Record<string, unknown> | undefined,
  options: AcpServeOptions,
): Promise<unknown> {
  const taskId = typeof params?.taskId === 'string' ? params.taskId : undefined
  if (taskId) {
    return handleTasksCancel({ id: taskId }, options)
  }
  const sessionId = typeof params?.sessionId === 'string' ? params.sessionId : ''
  acpSessions.delete(sessionId)
  return { sessionId, canceled: true }
}

async function handleToolsList(): Promise<unknown> {
  const toolPermissionContext = getEmptyToolPermissionContext()
  const tools = getTools(toolPermissionContext)
  return {
    tools: tools
      .filter(tool => tool.isEnabled())
      .map(tool => ({
        name: tool.name,
        description: tool.searchHint ?? tool.name,
        inputSchema: zodToJsonSchema(tool.inputSchema),
      })),
  }
}

async function handleToolsCall(params: Record<string, unknown> | undefined, options: AcpServeOptions): Promise<unknown> {
  const name = typeof params?.name === 'string' ? params.name : ''
  const args = (params?.arguments ?? {}) as Record<string, unknown>
  if (!name) {
    throw new Error('missing tool name')
  }

  const toolPermissionContext = getEmptyToolPermissionContext()
  const readFileStateCache = createFileStateCacheWithSizeLimit(100, 25 * 1024 * 1024)
  const tools = getTools(toolPermissionContext)
  const tool = findToolByName(tools, name)
  if (!tool) {
    throw new Error(`tool not found: ${name}`)
  }
  if (!tool.isEnabled()) {
    throw new Error(`tool not enabled: ${name}`)
  }

  const context = buildToolUseContext(tools, readFileStateCache)
  const validationResult = await tool.validateInput?.(args as never, context)
  if (validationResult?.result === false) {
    throw new Error(`invalid input: ${validationResult.message}`)
  }

  const result = await tool.call(
    args as never,
    context,
    hasPermissionsToUseTool,
    createAssistantMessage({ content: [] }),
  )

  return { result: result.data }
}

async function handleIdeDiffCapture(
  params: Record<string, unknown> | undefined,
  options: AcpServeOptions,
): Promise<unknown> {
  const result = await createIdeDiffBundle(options.cwd, {
    title: typeof params?.title === 'string' ? params.title : undefined,
    baseRef: typeof params?.baseRef === 'string' ? params.baseRef : undefined,
    staged: params?.staged === true,
    diff: typeof params?.diff === 'string' ? params.diff : undefined,
  })
  if (result.error) {
    throw new Error(result.error)
  }
  return {
    bundle: result.bundle,
    command: result.command,
    empty: !result.bundle,
  }
}

async function handleIdeSelect(
  params: Record<string, unknown> | undefined,
  options: AcpServeOptions,
): Promise<unknown> {
  const id = typeof params?.id === 'string' ? params.id : ''
  if (!id) {
    throw new Error('missing diff id')
  }
  const bundle = getIdeDiffBundle(options.cwd, id)
  if (!bundle) {
    throw new Error('IDE diff not found')
  }
  return { bundle, patch: readIdeDiffPatch(options.cwd, id) }
}

function headlessCommand(prompt: string): string[] {
  return [
    process.execPath,
    process.argv[1] ?? '',
    '-p',
    '--output-format',
    'json',
    prompt,
  ]
}

async function runSynchronousTask(options: AcpServeOptions, prompt: string): Promise<AcpTaskRecord> {
  const command = headlessCommand(prompt)
  const createdAt = now()
  const record: AcpTaskRecord = {
    id: createAcpId(),
    prompt,
    status: 'working',
    mode: 'sync',
    createdAt,
    updatedAt: createdAt,
  }
  if (options.dryRun) {
    record.status = 'completed'
    record.result = { dryRun: true, command }
    return record
  }
  const result = await execFileNoThrowWithCwd(command[0]!, command.slice(1), {
    cwd: options.cwd,
    timeout: 30 * 60 * 1000,
    preserveOutputOnError: true,
  })
  record.updatedAt = now()
  record.status = result.code === 0 ? 'completed' : 'failed'
  record.result = {
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr || result.error,
  }
  return record
}

function rememberTask(task: AcpTaskRecord): AcpTaskRecord {
  acpTasks.set(task.id, task)
  return task
}

async function startAsynchronousTask(options: AcpServeOptions, prompt: string): Promise<AcpTaskRecord> {
  const background = await startBackgroundTask({
    cwd: options.cwd,
    task: `ACP delegated task: ${prompt}`,
    dryRun: options.dryRun,
  })
  const createdAt = now()
  return {
    id: createAcpId(),
    prompt,
    backgroundTaskId: background.task.id,
    status: options.dryRun ? 'submitted' : mapBackgroundStatus(background.task.status),
    mode: 'async',
    createdAt,
    updatedAt: createdAt,
    result: options.dryRun ? { dryRun: true, command: background.command } : undefined,
  }
}

async function handleTasksSend(params: Record<string, unknown> | undefined, options: AcpServeOptions): Promise<unknown> {
  const prompt = typeof params?.prompt === 'string' ? params.prompt : ''
  if (!prompt.trim()) {
    throw new Error('missing prompt')
  }
  const mode = params?.mode === 'sync' ? 'sync' : 'async'
  if (mode === 'sync') {
    const task = await runSynchronousTask(options, prompt)
    return { task: rememberTask(task) }
  }
  const task = rememberTask(await startAsynchronousTask(options, prompt))
  return { task, statusUrl: `/acp/tasks/${encodeURIComponent(task.id)}` }
}

function hydrateTask(cwd: string, record: AcpTaskRecord): AcpTaskRecord {
  if (!record.backgroundTaskId) return record
  const background = getBackgroundTask(cwd, record.backgroundTaskId)
  if (!background) {
    return {
      ...record,
      status: record.status === 'canceled' ? 'canceled' : 'failed',
      error: record.error ?? `background task not found: ${record.backgroundTaskId}`,
    }
  }
  return {
    ...record,
    status: mapBackgroundStatus(background.status),
    updatedAt: background.updatedAt,
    result: {
      ...(typeof record.result === 'object' && record.result !== null ? record.result : {}),
      exitCode: background.exitCode,
    },
  }
}

function listTasks(options: AcpServeOptions): AcpTaskRecord[] {
  const knownBackgroundIds = new Set(
    [...acpTasks.values()]
      .map(task => task.backgroundTaskId)
      .filter((id): id is string => typeof id === 'string'),
  )
  const persisted = listBackgroundTasks(options.cwd)
    .filter(bg => bg.task.startsWith('ACP delegated task:'))
    .filter(bg => !knownBackgroundIds.has(bg.id))
    .map(bg => {
      const createdAt = bg.createdAt ?? now()
      return hydrateTask(options.cwd, {
        id: createAcpId(),
        prompt: bg.task.replace(/^ACP delegated task:\s*/u, ''),
        backgroundTaskId: bg.id,
        status: mapBackgroundStatus(bg.status),
        mode: 'async',
        createdAt,
        updatedAt: bg.updatedAt ?? createdAt,
      })
    })
  return [
    ...[...acpTasks.values()].map(task => hydrateTask(options.cwd, task)),
    ...persisted,
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

async function handleTasksGet(
  params: Record<string, unknown> | undefined,
  options: AcpServeOptions,
): Promise<unknown> {
  const id = typeof params?.id === 'string' ? params.id : ''
  const tasks = listTasks(options)
  if (!id) {
    return { tasks }
  }
  const task = tasks.find(t => t.id === id)
  if (!task) {
    throw new Error('task not found')
  }
  const log = task.backgroundTaskId
    ? readBackgroundLog(options.cwd, task.backgroundTaskId)
    : null
  return { task, log }
}

async function handleTasksCancel(
  params: Record<string, unknown> | undefined,
  options: AcpServeOptions,
): Promise<unknown> {
  const id = typeof params?.id === 'string' ? params.id : ''
  const task = listTasks(options).find(t => t.id === id)
  if (!task) {
    throw new Error('task not found')
  }
  if (task.backgroundTaskId) {
    stopBackgroundTask(options.cwd, task.backgroundTaskId)
  }
  const canceled = { ...task, status: 'canceled' as const, updatedAt: now() }
  acpTasks.set(canceled.id, canceled)
  return { task: canceled }
}

async function dispatchMethod(
  method: string,
  params: Record<string, unknown> | undefined,
  options: AcpServeOptions,
): Promise<unknown> {
  switch (method) {
    case 'initialize':
      return handleInitialize(options)
    case 'session/new':
      return handleSessionNew(params, options)
    case 'session/prompt':
      return handleSessionPrompt(params, options)
    case 'session/cancel':
      return handleSessionCancel(params, options)
    case 'tools/list':
      return handleToolsList()
    case 'tools/call':
      return handleToolsCall(params, options)
    case 'tasks/send':
      return handleTasksSend(params, options)
    case 'tasks/get':
      return handleTasksGet(params, options)
    case 'tasks/cancel':
      return handleTasksCancel(params, options)
    case 'ide/diffCapture':
      return handleIdeDiffCapture(params, options)
    case 'ide/select':
      return handleIdeSelect(params, options)
    case 'shutdown':
      // Stop after the response flushes so the client receives an ack.
      setTimeout(() => {
        void stopAcpServer()
      }, 10)
      return { ok: true }
    default:
      throw new Error(`unknown method: ${method}`)
  }
}

export async function handleAcpRequest(
  request: Request,
  options: AcpServeOptions,
): Promise<Response> {
  const url = new URL(request.url)
  if (request.method === 'GET' && url.pathname === '/healthz') {
    return jsonResponse(200, rpcResponse(null, { ok: true }))
  }
  if (url.pathname !== '/acp') {
    return jsonResponse(404, { error: 'not found' })
  }

  const auth = authorizeAcp(request, options)
  if (!auth.ok) {
    return jsonResponse(401, rpcError(null, -32001, auth.reason ?? 'unauthorized'))
  }

  let body: { id?: string | number | null; method?: string; params?: Record<string, unknown> } | null = null
  try {
    body = (await request.json()) as typeof body
  } catch {
    return jsonResponse(400, rpcError(null, -32700, 'parse error'))
  }

  const id = body?.id ?? null
  const method = body?.method
  if (typeof method !== 'string') {
    return jsonResponse(400, rpcError(id, -32600, 'invalid request'))
  }

  if (options.debug) {
    // eslint-disable-next-line no-console
    console.error(`[acp] ${method} ${jsonStringify(body.params ?? {})}`)
  }

  try {
    const result = await dispatchMethod(method, body.params, options)
    if (options.debug) {
      // eslint-disable-next-line no-console
      console.error(`[acp] ${method} -> ok`)
    }
    return jsonResponse(200, rpcResponse(id, result))
  } catch (error) {
    logError(error)
    const message = error instanceof Error ? error.message : String(error)
    if (options.debug) {
      // eslint-disable-next-line no-console
      console.error(`[acp] ${method} -> error: ${message}`)
    }
    return jsonResponse(500, rpcError(id, -32603, message))
  }
}

let acpServer: ReturnType<typeof Bun.serve> | null = null

export function getAcpServerPort(): number | null {
  return acpServer?.port ?? null
}

export async function stopAcpServer(): Promise<void> {
  if (acpServer) {
    acpServer.stop()
    acpServer = null
  }
  acpTasks.clear()
  acpSessions.clear()
}

function pickFallbackPort(): number {
  return 49_152 + Math.floor(Math.random() * 16_384)
}

function startAcpHttpServer(options: AcpServeOptions): ReturnType<typeof Bun.serve> {
  const ports = options.port === 0
    ? [0, ...Array.from({ length: 10 }, () => pickFallbackPort())]
    : [options.port]
  let lastError: unknown
  for (const port of ports) {
    try {
      return Bun.serve({
        hostname: options.host,
        port,
        fetch: request => handleAcpRequest(request, options),
      })
    } catch (error: unknown) {
      lastError = error
      if (options.port !== 0 || getErrnoCode(error) !== 'EADDRINUSE') {
        throw error
      }
    }
  }
  throw lastError
}

export async function serveAcp(options: AcpServeOptions): Promise<void> {
  if (!isLoopback(options.host) && !options.token) {
    throw new Error('Refusing to bind ACP server off-loopback without --token')
  }
  if (typeof Bun === 'undefined' || typeof Bun.serve !== 'function') {
    throw new Error('ACP server requires the Bun runtime')
  }

  await stopAcpServer()
  acpTasks.clear()

  acpServer = startAcpHttpServer(options)

  // eslint-disable-next-line no-console
  console.log(`ACP server listening on http://${options.host}:${acpServer.port}`)
  await new Promise(() => {
    // Keep process alive until interrupted.
  })
}
