import { resolveUrExecutable } from '../../utils/urExecutable.js'
import { createHash, randomUUID } from 'node:crypto'
import { createAcpHttpSessionManager, type AcpHttpSessionManager, type AcpPromptControl } from './acpHttpSessions.js'
import { AcpTeamController, AcpTeamError } from './acpTeam.js'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { getDefaultAppState } from 'src/state/AppStateStore.js'
import type { Command } from '../../commands.js'
import {
  findToolByName,
  getEmptyToolPermissionContext,
  type ToolPermissionContext,
  type ToolResult,
  type ToolUseContext,
} from '../../Tool.js'
import { parseMcpToolArguments } from '../../entrypoints/mcpToolAdapter.js'
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
import {
  InvalidRequestBodyEncodingError,
  RequestBodyTooLargeError,
  readRequestTextBounded,
} from '../../utils/readRequestTextBounded.js'
import {
  RollingRateLimitError,
  RollingRateLimiter,
  readPositiveInteger,
} from '../../utils/rollingRateLimiter.js'
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

const httpSessionManagers = new Map<string, AcpHttpSessionManager>()
const managedHttpSessions = new Set<AcpHttpSessionManager>()
export function getAcpHttpSessionManager(options: AcpServeOptions): AcpHttpSessionManager {
  if (options.sessionManager) { managedHttpSessions.add(options.sessionManager); return options.sessionManager }
  const key = createHash('sha256').update(`${resolve(options.cwd)}:${options.token ?? ''}:${options.dryRun === true}`).digest('hex')
  let manager = httpSessionManagers.get(key)
  if (!manager) {
    manager = createAcpHttpSessionManager(options)
    httpSessionManagers.set(key, manager); managedHttpSessions.add(manager)
  }
  return manager
}

function teamController(options: AcpServeOptions): AcpTeamController | undefined {
  const path = options.teamPolicyPath ?? process.env.UR_ACP_TEAM_POLICY
  if (!path) return undefined
  if (!options.token) throw new AcpTeamError('Team mode requires an operator bearer token.')
  try { return new AcpTeamController(path, options.cwd, getAcpHttpSessionManager(options).stateDirectory) }
  catch (error) { if (error instanceof AcpTeamError) throw error; throw new AcpTeamError('Unable to load trusted team policy or accounting state.') }
}

const MCP_COMMANDS: Command[] = []
const acpTasks = new Map<string, AcpTaskRecord>()
const acpRequestLimiter = new RollingRateLimiter({
  maxCalls: readPositiveInteger(
    process.env.UR_ACP_MAX_REQUESTS_PER_MINUTE,
    600,
    50_000,
  ),
  windowMs: 60_000,
  maxConcurrent: readPositiveInteger(
    process.env.UR_ACP_MAX_CONCURRENT_REQUESTS,
    32,
    500,
  ),
})
const acpToolLimiter = new RollingRateLimiter({
  maxCalls: readPositiveInteger(
    process.env.UR_ACP_MAX_TOOL_CALLS_PER_MINUTE,
    120,
    10_000,
  ),
  windowMs: 60_000,
  maxConcurrent: readPositiveInteger(
    process.env.UR_ACP_MAX_CONCURRENT_TOOL_CALLS,
    8,
    100,
  ),
})
const acpTaskLimiter = new RollingRateLimiter({
  maxCalls: readPositiveInteger(
    process.env.UR_ACP_MAX_TASKS_PER_MINUTE,
    30,
    10_000,
  ),
  windowMs: 60_000,
  maxConcurrent: readPositiveInteger(
    process.env.UR_ACP_MAX_CONCURRENT_TASKS,
    4,
    100,
  ),
})

class AcpRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'AcpRpcError'
  }
}

function jsonResponse(status: number, body: AcpResponse | { error: string }): Response {
  let responseStatus = status
  let responseBody = JSON.stringify(body)
  const maxResponseBytes = readPositiveInteger(
    process.env.UR_ACP_MAX_RESPONSE_BYTES,
    8_000_000,
    32_000_000,
  )
  if (Buffer.byteLength(responseBody, 'utf8') > maxResponseBytes) {
    const id = 'id' in body ? body.id : null
    responseStatus = 500
    responseBody = JSON.stringify(
      rpcError(
        typeof id === 'string' || typeof id === 'number' || id === null ? id : null,
        -32603,
        `response exceeds the configured ${maxResponseBytes}-byte limit`,
      ),
    )
  }
  return new Response(responseBody, {
    status: responseStatus,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json',
      'x-content-type-options': 'nosniff',
    },
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

function boundedErrorMessage(error: unknown): string {
  const maxChars = readPositiveInteger(
    process.env.UR_ACP_MAX_ERROR_CHARS,
    16_384,
    64_000,
  )
  const message = error instanceof Error ? error.message : String(error)
  return message.length <= maxChars
    ? message
    : `${message.slice(0, Math.max(0, maxChars - 1))}…`
}

function readOptionalIdentifier(
  value: unknown,
  label: string,
): string | undefined {
  if (value === undefined) return undefined
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 256 ||
    value.includes('\0')
  ) {
    throw new AcpRpcError(-32602, `${label} must be a non-empty string of at most 256 characters`)
  }
  return value
}

function isWithinPath(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate)
  return (
    pathFromRoot === '' ||
    (pathFromRoot !== '..' &&
      !pathFromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromRoot))
  )
}

async function resolveSessionWorkspace(
  requestedCwd: unknown,
  serverCwd: string,
): Promise<string> {
  if (requestedCwd === undefined) return serverCwd
  if (
    typeof requestedCwd !== 'string' ||
    requestedCwd.length === 0 ||
    requestedCwd.length > 4096 ||
    requestedCwd.includes('\0') ||
    !isAbsolute(requestedCwd)
  ) {
    throw new AcpRpcError(
      -32602,
      'cwd must be an absolute path of at most 4096 characters',
    )
  }

  try {
    const [canonicalRoot, canonicalCandidate] = await Promise.all([
      realpath(serverCwd),
      realpath(resolve(requestedCwd)),
    ])
    const candidateStat = await stat(canonicalCandidate)
    if (!candidateStat.isDirectory()) {
      throw new AcpRpcError(-32602, 'cwd must identify an existing directory')
    }
    if (!isWithinPath(canonicalRoot, canonicalCandidate)) {
      throw new AcpRpcError(-32602, 'cwd must be within the server workspace root')
    }
    return canonicalCandidate
  } catch (error) {
    if (error instanceof AcpRpcError) throw error
    throw new AcpRpcError(-32602, 'cwd must identify an accessible directory')
  }
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

function buildToolUseContext(
  tools: ReturnType<typeof getTools>,
  readFileStateCache: ReturnType<typeof createFileStateCacheWithSizeLimit>,
  toolPermissionContext: ToolPermissionContext,
  abortController: AbortController,
): ToolUseContext {
  const appState = {
    ...getDefaultAppState(),
    toolPermissionContext,
  }
  return {
    abortController,
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
    getAppState: () => appState,
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
    name: 'UR',
    version: MACRO.VERSION,
    protocolVersion: '0.1.0',
    workspaceRoot: options.cwd,
    capabilities: {
      tools: true,
      tasks: true,
      sessions: true,
      ide: true,
      streaming: true,
      durableSessions: true,
      permissionRequests: true,
      devicePairing: Boolean(options.token),
      teamControls: Boolean(options.teamPolicyPath ?? process.env.UR_ACP_TEAM_POLICY),
      cancellation: true,
    },
  }
}

type AcpSessionRecord = {
  id: string
  cwd: string
  createdAt: string
  lastUsedAt: string
  activePrompts: number
  abortController?: AbortController
  taskId?: string
}

const acpSessions = new Map<string, AcpSessionRecord>()

function reserveSessionCapacity(): void {
  const maxSessions = readPositiveInteger(
    process.env.UR_ACP_MAX_SESSIONS,
    1_000,
    10_000,
  )
  if (acpSessions.size < maxSessions) return

  const idleSession = [...acpSessions.values()]
    .filter(session => session.activePrompts === 0)
    .sort((a, b) => a.lastUsedAt.localeCompare(b.lastUsedAt))[0]
  if (!idleSession) {
    throw new AcpRpcError(
      -32029,
      `session limit reached (${maxSessions}); cancel an active session and retry`,
      429,
    )
  }
  acpSessions.delete(idleSession.id)
}

async function handleSessionNew(
  params: Record<string, unknown> | undefined,
  options: AcpServeOptions,
): Promise<unknown> {
  const cwd = await resolveSessionWorkspace(params?.cwd, options.cwd)
  reserveSessionCapacity()
  const createdAt = now()
  const created = getAcpHttpSessionManager(options).newSession(cwd)
  const session: AcpSessionRecord = {
    id: created.sessionId,
    cwd,
    createdAt,
    lastUsedAt: createdAt,
    activePrompts: 0,
  }
  acpSessions.set(session.id, session)
  return { sessionId: session.id, workspaceRoot: session.cwd }
}

async function handleSessionPrompt(
  params: Record<string, unknown> | undefined,
  options: AcpServeOptions,
  control?: AcpPromptControl,
): Promise<unknown> {
  const sessionId = readOptionalIdentifier(params?.sessionId, 'sessionId')
  if (params?.stream === true) {
    if (!sessionId) throw new AcpRpcError(-32602, 'sessionId is required for streaming')
    return getAcpHttpSessionManager(options).prompt(sessionId, params.prompt as string, readOptionalIdentifier(params.requestId, 'requestId'), control)
  }
  const session = sessionId ? acpSessions.get(sessionId) : undefined
  if (sessionId && !session) {
    throw new AcpRpcError(-32602, `unknown session: ${sessionId}`)
  }
  if (session && session.activePrompts > 0) {
    throw new AcpRpcError(-32002, `session already has a prompt in flight: ${sessionId}`)
  }

  const abortController = session ? new AbortController() : undefined
  if (session) {
    session.activePrompts += 1
    session.abortController = abortController
    session.lastUsedAt = now()
  }
  try {
    const sent = (await handleTasksSend(
      params,
      session ? { ...options, cwd: session.cwd } : options,
      abortController?.signal,
    )) as { task: AcpTaskRecord }
    if (session) session.taskId = sent.task.id
    return { sessionId: sessionId ?? null, ...sent }
  } finally {
    if (session) {
      session.activePrompts = Math.max(0, session.activePrompts - 1)
      if (session.abortController === abortController) {
        delete session.abortController
      }
      session.lastUsedAt = now()
    }
  }
}

async function handleSessionCancel(
  params: Record<string, unknown> | undefined,
  options: AcpServeOptions,
): Promise<unknown> {
  const taskId = readOptionalIdentifier(params?.taskId, 'taskId')
  if (taskId) {
    return handleTasksCancel({ id: taskId }, options)
  }
  const sessionId = readOptionalIdentifier(params?.sessionId, 'sessionId')
  if (!sessionId) {
    throw new AcpRpcError(-32602, 'sessionId or taskId is required')
  }
  const manager = getAcpHttpSessionManager(options)
  const remoteCanceled = manager.has(sessionId) ? manager.cancel(sessionId).canceled : false
  const session = acpSessions.get(sessionId)
  if (!session) return { sessionId, canceled: remoteCanceled }

  let canceled = remoteCanceled
  if (session.abortController && !session.abortController.signal.aborted) {
    session.abortController.abort()
    canceled = true
  }
  if (session.taskId) {
    const task = listTasks({ ...options, cwd: session.cwd })
      .find(candidate => candidate.id === session.taskId)
    if (task && (task.status === 'submitted' || task.status === 'working')) {
      await handleTasksCancel({ id: task.id }, { ...options, cwd: session.cwd })
      canceled = true
    }
  }
  session.lastUsedAt = now()
  return { sessionId, canceled }
}

async function handleSessionClose(
  params: Record<string, unknown> | undefined,
  options: AcpServeOptions,
): Promise<unknown> {
  const sessionId = readOptionalIdentifier(params?.sessionId, 'sessionId')
  if (!sessionId) {
    throw new AcpRpcError(-32602, 'sessionId is required')
  }
  const manager = getAcpHttpSessionManager(options)
  if (!acpSessions.has(sessionId) && !manager.has(sessionId)) return { sessionId, closed: false, canceled: false }
  const cancellation = await handleSessionCancel({ sessionId }, options) as {
    canceled: boolean
  }
  acpSessions.delete(sessionId)
  const remote = manager.has(sessionId) ? await manager.close(sessionId) : { closed: false, canceled: false }
  return { sessionId, closed: remote.closed, canceled: cancellation.canceled || remote.canceled }
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

async function handleToolsCall(
  params: Record<string, unknown> | undefined,
  _options: AcpServeOptions,
): Promise<unknown> {
  const name = typeof params?.name === 'string' ? params.name : ''
  const args = params?.arguments ?? {}
  if (!name) {
    throw new AcpRpcError(-32602, 'missing tool name')
  }

  const toolPermissionContext = {
    ...getEmptyToolPermissionContext(),
    shouldAvoidPermissionPrompts: true,
  }
  const readFileStateCache = createFileStateCacheWithSizeLimit(100, 25 * 1024 * 1024)
  const tools = getTools(toolPermissionContext)
  const tool = findToolByName(tools, name)
  if (!tool) {
    throw new AcpRpcError(-32602, `tool not found: ${name}`)
  }
  if (!tool.isEnabled()) {
    throw new Error(`tool not enabled: ${name}`)
  }

  const maxInputChars = readPositiveInteger(
    process.env.UR_ACP_MAX_TOOL_INPUT_CHARS,
    250_000,
    2_000_000,
  )
  const maxOutputChars = readPositiveInteger(
    process.env.UR_ACP_MAX_TOOL_OUTPUT_CHARS,
    1_000_000,
    10_000_000,
  )
  const timeoutMs = readPositiveInteger(
    process.env.UR_ACP_TOOL_TIMEOUT_MS,
    120_000,
    30 * 60_000,
  )
  const release = acpToolLimiter.acquire()
  const abortController = createAbortController()
  const context = buildToolUseContext(
    tools,
    readFileStateCache,
    toolPermissionContext,
    abortController,
  )
  let timeout: ReturnType<typeof setTimeout> | undefined
  let operation: Promise<ToolResult<unknown>> | undefined
  let timedOut = false

  try {
    let parsedArgs: Record<string, unknown>
    try {
      parsedArgs = await parseMcpToolArguments(tool, args, maxInputChars)
    } catch (error) {
      throw new AcpRpcError(
        -32602,
        error instanceof Error ? error.message : 'invalid tool arguments',
      )
    }
    const validationResult = await tool.validateInput?.(
      parsedArgs as never,
      context,
    )
    if (validationResult?.result === false) {
      throw new AcpRpcError(-32602, `invalid input: ${validationResult.message}`)
    }

    const parentMessage = createAssistantMessage({ content: [] })
    const permissionDecision = await hasPermissionsToUseTool(
      tool,
      parsedArgs,
      context,
      parentMessage,
      randomUUID(),
    )
    if (permissionDecision.behavior !== 'allow') {
      throw new AcpRpcError(
        -32003,
        permissionDecision.message ||
          `tool ${name} requires interactive approval, which is unavailable over ACP`,
      )
    }
    const authorizedArgs = await parseMcpToolArguments(
      tool,
      permissionDecision.updatedInput ?? parsedArgs,
      maxInputChars,
    )
    const authorizedValidation = await tool.validateInput?.(
      authorizedArgs as never,
      context,
    )
    if (authorizedValidation?.result === false) {
      throw new AcpRpcError(
        -32602,
        `invalid authorized input: ${authorizedValidation.message}`,
      )
    }
    operation = tool.call(
      authorizedArgs as never,
      context,
      hasPermissionsToUseTool,
      parentMessage,
    )
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        timedOut = true
        abortController.abort()
        reject(new Error(`tool ${name} exceeded the ACP timeout of ${timeoutMs}ms`))
      }, timeoutMs)
    })
    const result = await Promise.race([operation, timeoutPromise])
    if (timeout) clearTimeout(timeout)
    timeout = undefined

    let output = result.data
    if (tool.outputSchema) {
      const parsedOutput = await tool.outputSchema.safeParseAsync(output)
      if (!parsedOutput.success) {
        throw new Error(`tool ${name} returned output that does not match its schema`)
      }
      output = parsedOutput.data
    }
    if (output === undefined) output = null
    const serializedOutput = jsonStringify(output)
    if (serializedOutput.length > maxOutputChars) {
      throw new Error(
        `tool ${name} returned ${serializedOutput.length} characters, exceeding the ACP output limit of ${maxOutputChars}`,
      )
    }
    return { result: output }
  } finally {
    if (timeout) clearTimeout(timeout)
    if (timedOut && operation) {
      void operation.then(release, release)
    } else {
      release()
    }
  }
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

function headlessCommand(): string[] {
  const { file, baseArgs } = resolveUrExecutable()
  return [
    file,
    ...baseArgs,
    '-p',
    '--output-format',
    'json',
  ]
}

async function runSynchronousTask(
  options: AcpServeOptions,
  prompt: string,
  abortSignal?: AbortSignal,
): Promise<AcpTaskRecord> {
  const command = headlessCommand()
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
    abortSignal,
    cwd: options.cwd,
    timeout: readPositiveInteger(
      process.env.UR_ACP_TASK_TIMEOUT_MS,
      30 * 60_000,
      2 * 60 * 60_000,
    ),
    preserveOutputOnError: true,
    stdin: 'pipe',
    input: prompt,
    maxBuffer: readPositiveInteger(
      process.env.UR_ACP_MAX_TASK_OUTPUT_BYTES,
      2_000_000,
      8_000_000,
    ),
  })
  record.updatedAt = now()
  record.status = abortSignal?.aborted
    ? 'canceled'
    : result.code === 0
      ? 'completed'
      : 'failed'
  record.result = {
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr || result.error,
  }
  return record
}

function rememberTask(task: AcpTaskRecord, options: AcpServeOptions): AcpTaskRecord {
  const maxRetainedTasks = readPositiveInteger(
    process.env.UR_ACP_MAX_RETAINED_TASKS,
    1_000,
    10_000,
  )
  while (acpTasks.size >= maxRetainedTasks && !acpTasks.has(task.id)) {
    const removable = [...acpTasks.values()].find(candidate => {
      const status = hydrateTask(options.cwd, candidate).status
      return status !== 'submitted' && status !== 'working'
    })
    if (!removable) {
      throw new AcpRpcError(
        -32029,
        `retained task limit reached (${maxRetainedTasks})`,
        429,
      )
    }
    acpTasks.delete(removable.id)
  }
  acpTasks.set(task.id, task)
  return task
}

async function startAsynchronousTask(options: AcpServeOptions, prompt: string): Promise<AcpTaskRecord> {
  if (!options.dryRun) {
    const maxActiveTasks = readPositiveInteger(
      process.env.UR_ACP_MAX_ACTIVE_TASKS,
      4,
      100,
    )
    const activeTasks = listTasks(options).filter(
      task => task.status === 'submitted' || task.status === 'working',
    ).length
    if (activeTasks >= maxActiveTasks) {
      throw new AcpRpcError(
        -32029,
        `active ACP task limit reached (${maxActiveTasks})`,
        429,
      )
    }
  }
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

async function handleTasksSend(
  params: Record<string, unknown> | undefined,
  options: AcpServeOptions,
  abortSignal?: AbortSignal,
): Promise<unknown> {
  const release = acpTaskLimiter.acquire()
  try {
    const prompt = typeof params?.prompt === 'string' ? params.prompt : ''
    if (!prompt.trim()) {
      throw new AcpRpcError(-32602, 'missing prompt')
    }
    const maxPromptChars = readPositiveInteger(
      process.env.UR_ACP_MAX_PROMPT_CHARS,
      64_000,
      1_000_000,
    )
    if (prompt.length > maxPromptChars || prompt.includes('\0')) {
      throw new AcpRpcError(-32602, 'prompt is too large or invalid', 413)
    }
    if (
      params?.mode !== undefined &&
      params.mode !== 'sync' &&
      params.mode !== 'async'
    ) {
      throw new AcpRpcError(-32602, 'mode must be "sync" or "async"')
    }
    const mode = params?.mode === 'sync' ? 'sync' : 'async'
    if (mode === 'sync') {
      const task = await runSynchronousTask(options, prompt, abortSignal)
      return { task: rememberTask(task, options) }
    }
    if (abortSignal?.aborted) {
      throw new AcpRpcError(-32800, 'request canceled', 409)
    }
    const task = rememberTask(await startAsynchronousTask(options, prompt), options)
    return { task, statusUrl: `/acp/tasks/${encodeURIComponent(task.id)}` }
  } finally {
    release()
  }
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
        // Derive the compatibility id from the durable background id. A
        // random id here changed on every list/get call after server restart,
        // making a task returned by tasks/get impossible to fetch again.
        id: `acp_${bg.id}`,
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
  const id = readOptionalIdentifier(params?.id, 'id') ?? ''
  const tasks = listTasks(options)
  if (!id) {
    return { tasks }
  }
  const task = tasks.find(t => t.id === id)
  if (!task) {
    throw new Error('task not found')
  }
  const log = task.backgroundTaskId
    ? readBackgroundLog(
        options.cwd,
        task.backgroundTaskId,
        undefined,
        readPositiveInteger(
          process.env.UR_ACP_MAX_TASK_OUTPUT_BYTES,
          2_000_000,
          8_000_000,
        ),
      )
    : null
  return { task, log }
}

async function handleTasksCancel(
  params: Record<string, unknown> | undefined,
  options: AcpServeOptions,
): Promise<unknown> {
  const id = readOptionalIdentifier(params?.id, 'id') ?? ''
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
  control?: AcpPromptControl,
): Promise<unknown> {
  switch (method) {
    case 'initialize':
      return handleInitialize(options)
    case 'session/events':
      return getAcpHttpSessionManager(options).events(String(params?.sessionId ?? ''), params?.after === undefined ? 0 : params.after as number, params?.waitMs === undefined ? 0 : params.waitMs as number)
    case 'session/resume':
      return getAcpHttpSessionManager(options).resume(String(params?.sessionId ?? ''))
    case 'session/approve':
      return getAcpHttpSessionManager(options).approve(String(params?.sessionId ?? ''), String(params?.requestId ?? ''), params?.decision as { behavior?: unknown })
    case 'device/new':
      return getAcpHttpSessionManager(options).pair(params?.sessionIds as string[], params?.expiresInMs as number | undefined)
    case 'device/revoke':
      return getAcpHttpSessionManager(options).revoke(String(params?.deviceId ?? ''))
    case 'session/new':
      return handleSessionNew(params, options)
    case 'session/prompt':
      return handleSessionPrompt(params, options, control)
    case 'session/cancel':
      return handleSessionCancel(params, options)
    case 'session/close':
      return handleSessionClose(params, options)
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
      throw new AcpRpcError(-32601, `method not found: ${method}`)
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
  if (request.method !== 'POST') {
    const response = jsonResponse(405, rpcError(null, -32600, 'POST required'))
    response.headers.set('allow', 'POST')
    return response
  }

  const manager = getAcpHttpSessionManager(options)
  const auth = authorizeAcp(request, options)
  const device = auth.ok ? undefined : manager.deviceFor(request)
  if (!auth.ok && !device) {
    return jsonResponse(401, rpcError(null, -32001, auth.reason ?? 'unauthorized'))
  }

  const contentType = request.headers
    .get('content-type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase()
  if (contentType !== 'application/json') {
    return jsonResponse(
      415,
      rpcError(null, -32600, 'Content-Type must be application/json'),
    )
  }

  let releaseRequest: (() => void) | undefined
  try {
    releaseRequest = acpRequestLimiter.acquire()
  } catch (error) {
    if (error instanceof RollingRateLimitError) {
      return jsonResponse(429, rpcError(null, -32029, error.message))
    }
    throw error
  }

  try {
    const maxRequestBytes = readPositiveInteger(
      process.env.UR_ACP_MAX_REQUEST_BYTES,
      256_000,
      2_000_000,
    )
    let requestText: string
    try {
      requestText = await readRequestTextBounded(request, maxRequestBytes)
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonResponse(413, rpcError(null, -32600, 'request too large'))
      }
      if (error instanceof InvalidRequestBodyEncodingError) {
        return jsonResponse(400, rpcError(null, -32700, error.message))
      }
      throw error
    }

    let body: {
      jsonrpc?: unknown
      id?: unknown
      method?: unknown
      params?: unknown
    } | null = null
    try {
      const parsed = JSON.parse(requestText) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        body = parsed as typeof body
      }
    } catch {
      return jsonResponse(400, rpcError(null, -32700, 'parse error'))
    }

    const hasId = Boolean(
      body && Object.prototype.hasOwnProperty.call(body, 'id'),
    )
    const rawId = body?.id
    const idIsValid =
      rawId === null ||
      typeof rawId === 'string' ||
      (typeof rawId === 'number' && Number.isFinite(rawId))
    const id = hasId && idIsValid
      ? (rawId as string | number | null)
      : null
    const method = body?.method
    if (
      body?.jsonrpc !== '2.0' ||
      typeof method !== 'string' ||
      (hasId && !idIsValid)
    ) {
      return jsonResponse(400, rpcError(null, -32600, 'invalid request'))
    }
    const isNotification = !hasId
    if (
      body.params !== undefined &&
      (!body.params ||
        typeof body.params !== 'object' ||
        Array.isArray(body.params))
    ) {
      return isNotification
        ? new Response(null, { status: 204 })
        : jsonResponse(400, rpcError(id, -32602, 'invalid params'))
    }
    const params = body.params as Record<string, unknown> | undefined

    let team: AcpTeamController | undefined
    try { team = teamController(options) } catch (error) {
      return jsonResponse(403, rpcError(id, -32003, boundedErrorMessage(error)))
    }
    if (device && !(team && method === 'team/status') && !manager.deviceAllowed(device, method, params)) return jsonResponse(403, rpcError(id, -32003, 'device is not authorized for this method/session'))
    if ((method === 'device/new' || method === 'device/revoke') && auth.kind !== 'static') return jsonResponse(403, rpcError(id, -32003, 'operator bearer token is required'))

    if (options.debug) {
      // eslint-disable-next-line no-console
      console.error(`[acp] ${method} id=${hasId ? String(id) : 'notification'}`)
    }

    let reservation: ReturnType<AcpTeamController['reserve']> | undefined
    let dispatched = false
    const principal = device?.id ?? 'operator'
    try {
      if (team) {
        if (!device && auth.kind !== 'static') throw new AcpTeamError('Team mode requires an authenticated operator or device.')
        team.authorize(principal, method)
        if (['tasks/send', 'tools/call'].includes(method)) throw new AcpTeamError('Team execution uses durable session/prompt with stream:true; legacy execution would bypass team accounting.')
        if (method === 'session/prompt') {
          if (!params || typeof params.sessionId !== 'string' || !manager.has(params.sessionId)) throw new AcpTeamError('Unknown team session.')
          reservation = team.reserve(principal, params)
          if (reservation.duplicate && !manager.promptReceipt(params.sessionId, String(params.requestId))) throw new AcpTeamError('Quota receipt has no matching durable prompt; inspect interrupted accounting before retrying.')
        }
        // Persist the accepted operation before any tool/model side effect.
        team.audit(principal, method, 'accepted', params)
      }
      const result = team && method === 'team/status' ? team.status(principal)
        : team && method === 'team/audit' ? team.exportAudit(principal, params?.after as number | undefined)
        : team && method === 'team/reconcile' ? team.reconcile(principal, String(params?.receiptId ?? ''), String(params?.reason ?? ''))
        : await dispatchMethod(method, params, options, reservation && !reservation.duplicate ? { env: reservation.env, onComplete: failed => reservation!.finish(failed) } : undefined)
      dispatched = true
      if (device && !manager.deviceFor(request)) return jsonResponse(401, rpcError(id, -32001, 'device credential was revoked or expired'))
      if (team) teamController(options)?.authorize(principal, method)
      if (team) team.audit(principal, method, method === 'session/prompt' ? 'run-accepted' : 'completed',
        { ...params, ...(result && typeof result === 'object' && 'sessionId' in result ? { sessionId: result.sessionId } : {}) })
      if (options.debug) {
        // eslint-disable-next-line no-console
        console.error(`[acp] ${method} -> ok`)
      }
      return isNotification
        ? new Response(null, { status: 204 })
        : jsonResponse(200, rpcResponse(id, result))
    } catch (error) {
      if (!dispatched) { try { reservation?.finish(true) } catch { /* Preserve the primary failure; no execution was authorized. */ } }
      try { team?.audit(principal, method, 'rejected-or-failed', params) } catch { /* A failed audit cannot authorize execution. */ }
      if (
        !(error instanceof RollingRateLimitError) &&
        !(error instanceof AcpRpcError) && !(error instanceof AcpTeamError)
      ) {
        const category = error instanceof Error ? error.name : typeof error
        logError(new Error(`UR HTTP agent method ${method} failed (${category})`))
      }
      const message = boundedErrorMessage(error)
      if (options.debug) {
        // eslint-disable-next-line no-console
        console.error(
          `[acp] ${method} -> error (${error instanceof Error ? error.name : typeof error})`,
        )
      }
      if (isNotification) {
        return new Response(null, { status: 204 })
      }
      const rateLimited = error instanceof RollingRateLimitError
      const rpcFailure = error instanceof AcpRpcError ? error : undefined
      const teamFailure = error instanceof AcpTeamError ? error : undefined
      return jsonResponse(
        rateLimited ? 429 : (teamFailure?.status ?? rpcFailure?.status ?? 500),
        rpcError(
          id,
          rateLimited ? -32029 : teamFailure ? -32003 : (rpcFailure?.code ?? -32603),
          message,
        ),
      )
    }
  } finally {
    releaseRequest()
  }
}

let acpServer: ReturnType<typeof Bun.serve> | null = null

export function getAcpServerPort(): number | null {
  return acpServer?.port ?? null
}

export async function stopAcpServer(): Promise<void> {
  await Promise.all([...managedHttpSessions].map(manager => manager.stop()))
  httpSessionManagers.clear(); managedHttpSessions.clear()
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
        idleTimeout: 255,
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
  if (!Number.isSafeInteger(options.port) || options.port < 0 || options.port > 65535) {
    throw new Error('UR HTTP agent server port must be an integer between 0 and 65535')
  }
  if (!isLoopback(options.host) && !options.token) {
    throw new Error('Refusing to bind the UR HTTP agent server off-loopback without --token')
  }
  if (typeof Bun === 'undefined' || typeof Bun.serve !== 'function') {
    throw new Error('The UR HTTP agent server requires the Bun runtime')
  }

  await stopAcpServer()
  acpTasks.clear()

  acpServer = startAcpHttpServer(options)

  // eslint-disable-next-line no-console
  console.log(`UR HTTP agent server listening on http://${options.host}:${acpServer.port}`)
  await new Promise(() => {
    // Keep process alive until interrupted.
  })
}
