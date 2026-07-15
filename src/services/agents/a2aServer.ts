import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
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
import {
  backgroundDir,
  getBackgroundTask,
  listBackgroundTasks,
  readBackgroundLog,
  startBackgroundTask,
  stopBackgroundTask,
  type BackgroundTask,
} from './backgroundRunner.js'
import {
  constantTimeStringEqual,
  scopeAllows,
  verifyDelegationToken,
  type DelegationClaims,
} from './delegation.js'
import {
  A2AProtocolRuntime,
  inspectA2AProtocolRequest,
  type A2AProtocolIdentity,
} from './a2aProtocol.js'
import { buildA2AAgentCard } from './trends.js'

export type ServeOptions = {
  host: string
  port: number
  /** Externally reachable origin/path advertised by the Agent Card. */
  publicBaseUrl?: string
  token?: string
  /** HMAC secret that verifies issuer-minted A2A delegation tokens. */
  delegationSecret?: string
  /** Agent id this server answers to; delegation tokens must target it. */
  audience?: string
  dryRun?: boolean
  cwd: string
}

export type A2ATaskStatus =
  | 'submitted'
  | 'working'
  | 'completed'
  | 'failed'
  | 'canceled'

export type A2ATaskRecord = {
  id: string
  prompt: string
  skill?: string
  /** Delegation-token subject that created this task. Omitted for local/static callers. */
  owner?: string
  backgroundTaskId?: string
  status: A2ATaskStatus
  mode: 'async' | 'sync'
  createdAt: string
  updatedAt: string
  result?: {
    code?: number
    stdout?: string
    stderr?: string
  }
  error?: string
}

type A2AManifest = { version: 1; tasks: A2ATaskRecord[] }

const MAX_A2A_MANIFEST_BYTES = 16 * 1024 * 1024
const MAX_PERSISTED_A2A_TASKS = 1_000
const MAX_PERSISTED_RESULT_FIELD_BYTES = 1_000_000

const a2aSubmissionLimiter = new RollingRateLimiter({
  maxCalls: readPositiveInteger(
    process.env.UR_A2A_MAX_SUBMISSIONS_PER_MINUTE,
    30,
    10_000,
  ),
  windowMs: 60_000,
  maxConcurrent: readPositiveInteger(
    process.env.UR_A2A_MAX_CONCURRENT_SUBMISSIONS,
    4,
    100,
  ),
})

let a2aMutationTail = Promise.resolve()

async function withA2AMutation<T>(operation: () => Promise<T> | T): Promise<T> {
  const previous = a2aMutationTail
  let release!: () => void
  a2aMutationTail = new Promise<void>(resolve => {
    release = resolve
  })
  await previous
  try {
    return await operation()
  } finally {
    release()
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json',
      'x-content-type-options': 'nosniff',
    },
  })
}

function protocolJsonResponse(
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json',
      'a2a-version': '0.3',
      'x-content-type-options': 'nosniff',
      ...extraHeaders,
    },
  })
}

function bearerValue(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match ? match[1].trim() : null
}

export type AuthResult = {
  ok: boolean
  kind?: 'none' | 'static' | 'delegation'
  claims?: DelegationClaims
  reason?: string
}

/**
 * Authorize a task request. A static shared-secret bearer token still works for
 * back-compat; in addition, an issuer-minted delegation token is accepted when its
 * signature, audience, expiry, and scope all check out. When neither a token
 * nor a delegation secret is configured the server stays open (loopback only).
 */
export function authorizeRequest(
  request: Request,
  options: Pick<ServeOptions, 'token' | 'delegationSecret' | 'audience'>,
  requiredScope?: string,
): AuthResult {
  const hasStatic = Boolean(options.token)
  const hasDelegation = Boolean(options.delegationSecret)
  if (!hasStatic && !hasDelegation) return { ok: true, kind: 'none' }

  const bearer = bearerValue(request)
  if (!bearer) return { ok: false, reason: 'missing bearer token' }
  if (
    hasStatic &&
    typeof options.token === 'string' &&
    constantTimeStringEqual(bearer, options.token)
  ) {
    return { ok: true, kind: 'static' }
  }
  if (hasDelegation) {
    const audienceAliases =
      !options.audience || options.audience === 'UR'
        ? ['ur-agent', 'ur-nexus']
        : []
    const result = verifyDelegationToken(options.delegationSecret as string, bearer, {
      audience: options.audience,
      audienceAliases,
      requiredScope,
    })
    if (result.valid) {
      return { ok: true, kind: 'delegation', claims: result.claims }
    }
    return { ok: false, reason: result.reason ?? 'invalid delegation token' }
  }
  return { ok: false, reason: 'invalid token' }
}

function serverAgentCard(options: ServeOptions, baseUrl: string) {
  return buildA2AAgentCard({
    baseUrl,
    staticBearer: Boolean(options.token),
    delegationBearer: Boolean(options.delegationSecret),
  })
}

const protocolRuntimeCache = new WeakMap<
  ServeOptions,
  { baseUrl: string; runtime: A2AProtocolRuntime }
>()

function protocolRuntime(
  options: ServeOptions,
  baseUrl: string,
): A2AProtocolRuntime {
  const cached = protocolRuntimeCache.get(options)
  if (cached?.baseUrl === baseUrl) return cached.runtime
  const runtime = new A2AProtocolRuntime({
    cwd: options.cwd,
    card: serverAgentCard(options, baseUrl),
    dryRun: options.dryRun,
  })
  protocolRuntimeCache.set(options, { baseUrl, runtime })
  return runtime
}

function protocolIdentity(
  auth: AuthResult,
  requestedSkill?: string,
): A2AProtocolIdentity {
  const userName =
    auth.kind === 'delegation'
      ? (auth.claims?.sub ?? 'delegation')
      : auth.kind === 'static'
        ? 'static-token'
        : 'local'
  return {
    isAuthenticated: auth.kind === 'static' || auth.kind === 'delegation',
    userName,
    scopes: auth.kind === 'delegation' ? (auth.claims?.scope ?? []) : ['*'],
    requestedSkill,
  }
}

function protocolError(
  id: string | number | null,
  code: number,
  message: string,
): { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string } } {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

async function handleA2AProtocolRequest(
  request: Request,
  options: ServeOptions,
  baseUrl: string,
): Promise<Response> {
  // Reject unauthenticated requests before reading a potentially streamed body.
  const preliminaryAuth = authorizeRequest(request, options)
  if (!preliminaryAuth.ok) {
    return protocolJsonResponse(
      401,
      protocolError(null, -32000, 'Unauthorized'),
      { 'www-authenticate': 'Bearer' },
    )
  }

  const contentType = request.headers
    .get('content-type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase()
  if (contentType !== 'application/json') {
    return protocolJsonResponse(
      415,
      protocolError(null, -32600, 'Content-Type must be application/json'),
    )
  }

  const requestedVersion = request.headers.get('a2a-version')?.trim()
  if (
    requestedVersion &&
    requestedVersion !== '0.3' &&
    requestedVersion !== '0.3.0'
  ) {
    return protocolJsonResponse(
      400,
      protocolError(
        null,
        -32600,
        `Unsupported A2A version "${requestedVersion}"; this endpoint supports 0.3`,
      ),
    )
  }

  let requestText: string
  try {
    requestText = await readRequestTextBounded(
      request,
      readPositiveInteger(
        process.env.UR_A2A_MAX_REQUEST_BYTES,
        256_000,
        2_000_000,
      ),
    )
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return protocolJsonResponse(
        413,
        protocolError(null, -32600, 'Request body is too large'),
      )
    }
    if (error instanceof InvalidRequestBodyEncodingError) {
      return protocolJsonResponse(
        400,
        protocolError(null, -32700, error.message),
      )
    }
    throw error
  }

  let payload: unknown
  try {
    payload = JSON.parse(requestText)
  } catch {
    return protocolJsonResponse(
      200,
      protocolError(null, -32700, 'Parse error'),
    )
  }

  const inspection = inspectA2AProtocolRequest(payload)
  let auth = preliminaryAuth
  let releaseSubmission: (() => void) | undefined
  if (
    inspection.method === 'message/send' ||
    inspection.method === 'message/stream'
  ) {
    if (!inspection.prompt?.trim()) {
      return protocolJsonResponse(
        200,
        protocolError(
          inspection.id,
          -32602,
          'A2A messages must contain at least one non-empty text part',
        ),
      )
    }
    const maxPromptChars = readPositiveInteger(
      process.env.UR_A2A_MAX_PROMPT_CHARS,
      64_000,
      1_000_000,
    )
    if (
      inspection.prompt.length > maxPromptChars ||
      inspection.prompt.includes('\0')
    ) {
      return protocolJsonResponse(
        413,
        protocolError(inspection.id, -32602, 'Prompt is too large or invalid'),
      )
    }
    if (inspection.skill.length > 128 || inspection.skill.includes('\0')) {
      return protocolJsonResponse(
        200,
        protocolError(inspection.id, -32602, 'Invalid skill id'),
      )
    }
    const knownSkills = new Set(
      serverAgentCard(options, baseUrl).skills.map(skill => skill.id),
    )
    if (!knownSkills.has(inspection.skill)) {
      return protocolJsonResponse(
        200,
        protocolError(
          inspection.id,
          -32602,
          `Unknown skill: ${inspection.skill}`,
        ),
      )
    }
    auth = authorizeRequest(request, options, inspection.skill)
    if (!auth.ok) {
      return protocolJsonResponse(
        403,
        protocolError(inspection.id, -32000, 'Insufficient delegation scope'),
      )
    }
    try {
      releaseSubmission = a2aSubmissionLimiter.acquire()
    } catch (error) {
      if (error instanceof RollingRateLimitError) {
        return protocolJsonResponse(
          429,
          protocolError(inspection.id, -32000, error.message),
          { 'retry-after': '60' },
        )
      }
      throw error
    }
  }

  try {
    const response = await protocolRuntime(options, baseUrl).handle(
      payload,
      protocolIdentity(
        auth,
        inspection.method === 'message/send' ? inspection.skill : undefined,
      ),
    )
    return protocolJsonResponse(200, response)
  } finally {
    releaseSubmission?.()
  }
}

function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

function now(): string {
  return new Date().toISOString()
}

function a2aDir(cwd: string): string {
  return join(dirname(backgroundDir(cwd)), 'a2a')
}

function manifestPath(cwd: string): string {
  return join(a2aDir(cwd), 'tasks.json')
}

function ensureA2ADir(cwd: string): void {
  mkdirSync(a2aDir(cwd), { recursive: true, mode: 0o700 })
}

function isA2ATaskRecord(value: unknown): value is A2ATaskRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const task = value as Partial<A2ATaskRecord>
  return (
    typeof task.id === 'string' &&
    typeof task.prompt === 'string' &&
    (task.mode === 'async' || task.mode === 'sync') &&
    typeof task.createdAt === 'string' &&
    typeof task.updatedAt === 'string' &&
    ['submitted', 'working', 'completed', 'failed', 'canceled'].includes(
      task.status ?? '',
    )
  )
}

function loadA2AManifest(cwd: string): A2AManifest {
  const path = manifestPath(cwd)
  if (!existsSync(path)) return { version: 1, tasks: [] }
  try {
    if (statSync(path).size > MAX_A2A_MANIFEST_BYTES) {
      return { version: 1, tasks: [] }
    }
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<A2AManifest>
    if (parsed && Array.isArray(parsed.tasks)) {
      return {
        version: 1,
        tasks: parsed.tasks
          .filter(isA2ATaskRecord)
          .slice(-MAX_PERSISTED_A2A_TASKS),
      }
    }
  } catch {
    // Corrupt local state should not take down the sidecar; start with an empty view.
  }
  return { version: 1, tasks: [] }
}

function truncateUtf8(value: string | undefined, maxBytes: number): string | undefined {
  if (value === undefined || Buffer.byteLength(value, 'utf8') <= maxBytes) {
    return value
  }
  return `${Buffer.from(value, 'utf8').subarray(0, maxBytes).toString('utf8')}\n...[truncated for persistence]`
}

function saveA2AManifest(cwd: string, manifest: A2AManifest): void {
  ensureA2ADir(cwd)
  const destination = manifestPath(cwd)
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
  const tasks = manifest.tasks.slice(-MAX_PERSISTED_A2A_TASKS).map(task => ({
    ...task,
    ...(task.result
      ? {
          result: {
            ...task.result,
            stdout: truncateUtf8(
              task.result.stdout,
              MAX_PERSISTED_RESULT_FIELD_BYTES,
            ),
            stderr: truncateUtf8(
              task.result.stderr,
              MAX_PERSISTED_RESULT_FIELD_BYTES,
            ),
          },
        }
      : {}),
  }))
  let serialized = ''
  for (;;) {
    serialized = `${JSON.stringify({ version: 1, tasks }, null, 2)}\n`
    if (
      Buffer.byteLength(serialized, 'utf8') <= MAX_A2A_MANIFEST_BYTES ||
      tasks.length <= 1
    ) {
      break
    }
    tasks.splice(0, Math.max(1, Math.ceil(tasks.length / 10)))
  }
  try {
    writeFileSync(temporary, serialized, {
      mode: 0o600,
    })
    renameSync(temporary, destination)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

function createA2AId(): string {
  return `a2a_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`
}

function mapBackgroundStatus(status: BackgroundTask['status']): A2ATaskStatus {
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

function hydrateA2ATask(cwd: string, record: A2ATaskRecord): A2ATaskRecord {
  if (!record.backgroundTaskId) return record
  const background = getBackgroundTask(cwd, record.backgroundTaskId)
  if (!background) {
    return {
      ...record,
      status: record.status === 'canceled' ? 'canceled' : 'failed',
      error: record.error ?? `Background task not found: ${record.backgroundTaskId}`,
    }
  }
  return {
    ...record,
    status: mapBackgroundStatus(background.status),
    updatedAt: background.updatedAt,
    error: background.error ?? record.error,
    result: {
      ...record.result,
      code: background.exitCode ?? record.result?.code,
    },
  }
}

function listA2ATasks(cwd: string): A2ATaskRecord[] {
  const manifest = loadA2AManifest(cwd)
  const backgroundIds = new Set(manifest.tasks.map(t => t.backgroundTaskId).filter(Boolean))
  let changed = false
  for (const background of listBackgroundTasks(cwd)) {
    if (!background.task.startsWith('A2A delegated task:') || backgroundIds.has(background.id)) {
      continue
    }
    manifest.tasks.push({
      // A durable compatibility id must survive process restarts. Deriving it
      // from the background task also makes concurrent recovery idempotent.
      id: `a2a_${background.id}`,
      prompt: background.task.replace(/^A2A delegated task:\s*/u, ''),
      backgroundTaskId: background.id,
      status: mapBackgroundStatus(background.status),
      mode: 'async',
      createdAt: background.createdAt,
      updatedAt: background.updatedAt,
    })
    changed = true
  }
  if (changed) saveA2AManifest(cwd, manifest)
  return manifest.tasks
    .map(task => hydrateA2ATask(cwd, task))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function getA2ATask(cwd: string, id: string): A2ATaskRecord | null {
  return listA2ATasks(cwd).find(task => task.id === id) ?? null
}

function updateA2ATask(
  cwd: string,
  id: string,
  fn: (task: A2ATaskRecord) => void,
): A2ATaskRecord | null {
  const manifest = loadA2AManifest(cwd)
  const task = manifest.tasks.find(t => t.id === id)
  if (!task) return null
  fn(task)
  task.updatedAt = now()
  saveA2AManifest(cwd, manifest)
  return hydrateA2ATask(cwd, task)
}

function taskIdFromPath(pathname: string): { id: string; subresource?: string } | null {
  const match = /^\/a2a\/tasks\/([^/]+)(?:\/([^/]+))?$/u.exec(pathname)
  if (!match) return null
  try {
    return {
      id: decodeURIComponent(match[1] ?? ''),
      subresource: match[2] ? decodeURIComponent(match[2]) : undefined,
    }
  } catch {
    return null
  }
}

function authCanAccessTask(auth: AuthResult, task: A2ATaskRecord): boolean {
  if (!auth.ok) return false
  if (auth.kind === 'none' || auth.kind === 'static') return true
  if (!auth.claims || task.owner !== auth.claims.sub) return false
  return scopeAllows(auth.claims.scope, task.skill ?? 'coding-agent')
}

function delegationOwner(auth: AuthResult): string | undefined {
  return auth.ok && auth.kind === 'delegation' ? auth.claims?.sub : undefined
}

type TaskRequestBody = {
  prompt?: unknown
  skill?: unknown
  mode?: unknown
  wait?: unknown
  worktree?: unknown
  model?: unknown
  maxTurns?: unknown
  skipPermissions?: unknown
}

function headlessCommand(): string[] {
  return [
    process.execPath,
    process.argv[1] ?? '',
    '-p',
    '--output-format',
    'json',
  ]
}

async function runSynchronousTask(
  options: ServeOptions,
  prompt: string,
  skill: string,
  skipPermissions: boolean,
  owner?: string,
): Promise<Response> {
  const command = headlessCommand()
  if (skipPermissions) command.push('--dangerously-skip-permissions')
  const createdAt = now()
  const record: A2ATaskRecord = {
    id: createA2AId(),
    prompt,
    skill,
    owner,
    status: 'working',
    mode: 'sync',
    createdAt,
    updatedAt: createdAt,
  }
  if (options.dryRun) {
    return jsonResponse(200, { dryRun: true, command, task: record })
  }
  const result = await execFileNoThrowWithCwd(command[0]!, command.slice(1), {
    cwd: options.cwd,
    timeout: readPositiveInteger(
      process.env.UR_A2A_TASK_TIMEOUT_MS,
      30 * 60 * 1000,
      2 * 60 * 60 * 1000,
    ),
    preserveOutputOnError: true,
    stdin: 'pipe',
    input: prompt,
    maxBuffer: readPositiveInteger(
      process.env.UR_A2A_MAX_OUTPUT_BYTES,
      2_000_000,
      8_000_000,
    ),
  })
  record.updatedAt = now()
  record.status = result.code === 0 ? 'completed' : 'failed'
  record.result = {
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr || result.error,
  }
  await withA2AMutation(() => {
    const manifest = loadA2AManifest(options.cwd)
    manifest.tasks.push(record)
    saveA2AManifest(options.cwd, manifest)
  })
  return jsonResponse(result.code === 0 ? 200 : 500, {
    task: record,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr || result.error,
  })
}

async function startAsynchronousTaskUnlocked(
  options: ServeOptions,
  body: TaskRequestBody,
  prompt: string,
  skill: string,
  owner?: string,
): Promise<Response> {
  if (!options.dryRun) {
    const active = listA2ATasks(options.cwd).filter(
      task => task.status === 'submitted' || task.status === 'working',
    )
    const maxActiveTasks = readPositiveInteger(
      process.env.UR_A2A_MAX_ACTIVE_TASKS,
      16,
      500,
    )
    const maxActiveTasksPerOwner = readPositiveInteger(
      process.env.UR_A2A_MAX_ACTIVE_TASKS_PER_OWNER,
      4,
      100,
    )
    if (active.length >= maxActiveTasks) {
      return jsonResponse(429, {
        error: 'active_task_limit',
        reason: `active A2A compatibility tasks reached the server limit (${maxActiveTasks})`,
      })
    }
    const ownedActive = active.filter(task => task.owner === owner).length
    if (ownedActive >= maxActiveTasksPerOwner) {
      return jsonResponse(429, {
        error: 'active_task_limit',
        reason: `active tasks reached the caller limit (${maxActiveTasksPerOwner})`,
      })
    }
  }

  const maxTurns =
    typeof body.maxTurns === 'number'
      ? body.maxTurns
      : typeof body.maxTurns === 'string'
        ? Number(body.maxTurns)
        : undefined
  const boundedMaxTurns =
    typeof maxTurns === 'number' &&
    Number.isSafeInteger(maxTurns) &&
    maxTurns > 0 &&
    maxTurns <= 10_000
      ? maxTurns
      : undefined
  const model =
    typeof body.model === 'string' &&
    body.model.trim() &&
    body.model.length <= 256 &&
    !body.model.includes('\0')
      ? body.model.trim()
      : undefined
  const background = await startBackgroundTask({
    cwd: options.cwd,
    task: `A2A delegated task: ${prompt}`,
    worktree: body.worktree === true,
    model,
    maxTurns: boundedMaxTurns,
    skipPermissions: body.skipPermissions === true,
    dryRun: options.dryRun,
  })
  const createdAt = now()
  const record: A2ATaskRecord = {
    id: createA2AId(),
    prompt,
    skill,
    owner,
    backgroundTaskId: background.task.id,
    status: background.dryRun ? 'submitted' : mapBackgroundStatus(background.task.status),
    mode: 'async',
    createdAt,
    updatedAt: createdAt,
  }
  const manifest = loadA2AManifest(options.cwd)
  manifest.tasks.push(record)
  saveA2AManifest(options.cwd, manifest)
  return jsonResponse(options.dryRun ? 200 : 202, {
    dryRun: options.dryRun || undefined,
    command: background.command,
    task: hydrateA2ATask(options.cwd, record),
    statusUrl: `/a2a/tasks/${encodeURIComponent(record.id)}`,
    outputUrl: `/a2a/tasks/${encodeURIComponent(record.id)}/output`,
  })
}

async function startAsynchronousTask(
  options: ServeOptions,
  body: TaskRequestBody,
  prompt: string,
  skill: string,
  owner?: string,
): Promise<Response> {
  // Both the A2A compatibility manifest and the shared background manifest use
  // read-modify-rename persistence. Serialize admission + creation so two
  // simultaneous submissions cannot lose one another's records.
  return withA2AMutation(() =>
    startAsynchronousTaskUnlocked(options, body, prompt, skill, owner),
  )
}

async function handleTaskSubmission(
  request: Request,
  options: ServeOptions,
): Promise<Response> {
  // Authenticate before consuming a potentially chunked request body or an
  // admission slot. Scope is checked after the small, bounded body reveals the
  // requested skill.
  const auth = authorizeRequest(request, options)
  if (!auth.ok) {
    return jsonResponse(401, { error: 'unauthorized', reason: auth.reason })
  }

  const contentType = request.headers
    .get('content-type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase()
  if (contentType !== 'application/json') {
    return jsonResponse(415, { error: 'Content-Type must be application/json' })
  }

  let releaseSubmission: (() => void) | undefined
  try {
    releaseSubmission = a2aSubmissionLimiter.acquire()
  } catch (error) {
    if (error instanceof RollingRateLimitError) {
      return jsonResponse(429, { error: 'rate_limited', reason: error.message })
    }
    throw error
  }

  try {
    const maxRequestBytes = readPositiveInteger(
      process.env.UR_A2A_MAX_REQUEST_BYTES,
      256_000,
      2_000_000,
    )
    let requestText: string
    try {
      requestText = await readRequestTextBounded(request, maxRequestBytes)
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonResponse(413, { error: 'request too large' })
      }
      if (error instanceof InvalidRequestBodyEncodingError) {
        return jsonResponse(400, { error: error.message })
      }
      throw error
    }

    let body: TaskRequestBody | null = null
    try {
      const parsed = JSON.parse(requestText) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        body = parsed as TaskRequestBody
      }
    } catch {
      return jsonResponse(400, { error: 'invalid JSON request body' })
    }
    if (!body) {
      return jsonResponse(400, { error: 'invalid request body' })
    }

    if (
      (body.mode !== undefined && body.mode !== 'async' && body.mode !== 'sync') ||
      (body.wait !== undefined && typeof body.wait !== 'boolean') ||
      (body.worktree !== undefined && typeof body.worktree !== 'boolean') ||
      (body.skipPermissions !== undefined &&
        typeof body.skipPermissions !== 'boolean')
    ) {
      return jsonResponse(400, { error: 'invalid task option type or value' })
    }
    if (
      body.model !== undefined &&
      (typeof body.model !== 'string' ||
        !body.model.trim() ||
        body.model.length > 256 ||
        body.model.includes('\0'))
    ) {
      return jsonResponse(400, { error: 'model must be a non-empty safe string' })
    }
    if (body.maxTurns !== undefined) {
      const maxTurns =
        typeof body.maxTurns === 'number'
          ? body.maxTurns
          : typeof body.maxTurns === 'string'
            ? Number(body.maxTurns)
            : Number.NaN
      if (
        !Number.isSafeInteger(maxTurns) ||
        maxTurns < 1 ||
        maxTurns > 10_000
      ) {
        return jsonResponse(400, {
          error: 'maxTurns must be an integer between 1 and 10000',
        })
      }
    }

    const requestedSkill =
      typeof body.skill === 'string' && body.skill.trim()
        ? body.skill.trim()
        : 'coding-agent'
    const knownSkills = new Set(
      buildA2AAgentCard().skills.map(candidate => candidate.id),
    )
    if (!knownSkills.has(requestedSkill)) {
      return jsonResponse(400, { error: `unknown skill: ${requestedSkill}` })
    }
    if (
      auth.kind === 'delegation' &&
      (!auth.claims || !scopeAllows(auth.claims.scope, requestedSkill))
    ) {
      return jsonResponse(401, {
        error: 'unauthorized',
        reason: `scope "${requestedSkill}" not granted`,
      })
    }
    if (
      body.skipPermissions === true &&
      auth.kind !== 'static' &&
      !(
        auth.kind === 'delegation' &&
        auth.claims &&
        scopeAllows(auth.claims.scope, 'permissions:bypass')
      )
    ) {
      return jsonResponse(403, {
        error: 'forbidden',
        reason:
          'skipPermissions requires the static server token or a delegation token scoped to permissions:bypass',
      })
    }

    const prompt = typeof body.prompt === 'string' ? body.prompt : ''
    if (!prompt.trim()) {
      return jsonResponse(400, { error: 'missing prompt' })
    }
    const maxPromptChars = readPositiveInteger(
      process.env.UR_A2A_MAX_PROMPT_CHARS,
      64_000,
      1_000_000,
    )
    if (prompt.length > maxPromptChars || prompt.includes('\0')) {
      return jsonResponse(413, { error: 'prompt too large or invalid' })
    }

    if (body.wait === true || body.mode === 'sync') {
      return await runSynchronousTask(
        options,
        prompt,
        requestedSkill,
        body.skipPermissions === true,
        delegationOwner(auth),
      )
    }
    return await startAsynchronousTask(
      options,
      body,
      prompt,
      requestedSkill,
      delegationOwner(auth),
    )
  } finally {
    releaseSubmission?.()
  }
}

export async function handleA2ARequest(
  request: Request,
  options: ServeOptions,
  baseUrl: string,
): Promise<Response> {
  const url = new URL(request.url)
  if (request.method === 'GET' && url.pathname === '/healthz') {
    return jsonResponse(200, { ok: true })
  }
  if (
    request.method === 'GET' &&
    (url.pathname === '/.well-known/agent-card.json' ||
      url.pathname === '/agent-card.json')
  ) {
    return jsonResponse(200, serverAgentCard(options, baseUrl))
  }
  if (url.pathname === '/a2a/jsonrpc') {
    if (request.method !== 'POST') {
      return protocolJsonResponse(
        405,
        protocolError(null, -32600, 'POST required'),
        { allow: 'POST' },
      )
    }
    return handleA2AProtocolRequest(request, options, baseUrl)
  }
  if (request.method === 'GET' && url.pathname === '/a2a/tasks') {
    const auth = authorizeRequest(request, options)
    if (!auth.ok) {
      return jsonResponse(401, { error: 'unauthorized', reason: auth.reason })
    }
    const tasks = await withA2AMutation(() => listA2ATasks(options.cwd))
    return jsonResponse(200, {
      tasks: tasks.filter(task => authCanAccessTask(auth, task)),
    })
  }
  if (request.method === 'POST' && url.pathname === '/a2a/tasks') {
    return handleTaskSubmission(request, options)
  }
  const taskPath = taskIdFromPath(url.pathname)
  if (taskPath) {
    const auth = authorizeRequest(request, options)
    if (!auth.ok) {
      return jsonResponse(401, { error: 'unauthorized', reason: auth.reason })
    }
    const task = await withA2AMutation(() =>
      getA2ATask(options.cwd, taskPath.id),
    )
    if (!task) return jsonResponse(404, { error: 'task not found' })
    if (!authCanAccessTask(auth, task)) {
      return jsonResponse(404, { error: 'task not found' })
    }

    if (request.method === 'GET' && !taskPath.subresource) {
      return jsonResponse(200, { task })
    }
    if (request.method === 'GET' && taskPath.subresource === 'output') {
      const background =
        task.backgroundTaskId ? getBackgroundTask(options.cwd, task.backgroundTaskId) : null
      const log =
        task.backgroundTaskId
          ? readBackgroundLog(
              options.cwd,
              task.backgroundTaskId,
              undefined,
              readPositiveInteger(
                process.env.UR_A2A_MAX_OUTPUT_BYTES,
                2_000_000,
                8_000_000,
              ),
            )
          : null
      return jsonResponse(200, {
        task,
        outputFile: background?.outputFile,
        logFile: background?.logFile,
        log,
        result: task.result,
      })
    }
    if (
      request.method === 'DELETE' ||
      (request.method === 'POST' && taskPath.subresource === 'cancel')
    ) {
      if (task.backgroundTaskId) {
        stopBackgroundTask(options.cwd, task.backgroundTaskId)
      }
      const canceled = await withA2AMutation(() =>
        updateA2ATask(options.cwd, task.id, t => {
          t.status = 'canceled'
        }),
      )
      return jsonResponse(200, { task: canceled ?? task })
    }
  }
  return jsonResponse(404, { error: 'not found' })
}

export async function serveA2A(options: ServeOptions): Promise<void> {
  if (!Number.isSafeInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error('A2A server port must be an integer between 1 and 65535')
  }
  if (!isLoopback(options.host) && !options.token && !options.delegationSecret) {
    throw new Error(
      'Refusing to bind a2a server off-loopback without --token or --delegation-secret',
    )
  }
  if (typeof Bun === 'undefined' || typeof Bun.serve !== 'function') {
    throw new Error('A2A server requires the Bun runtime')
  }

  if (
    (options.host === '0.0.0.0' || options.host === '::') &&
    !options.publicBaseUrl
  ) {
    throw new Error(
      'A wildcard A2A bind requires --public-base-url so the Agent Card advertises a reachable endpoint',
    )
  }
  let baseUrl = `http://${options.host}:${options.port}`
  if (options.publicBaseUrl) {
    let parsed: URL
    try {
      parsed = new URL(options.publicBaseUrl)
    } catch {
      throw new Error('A2A public base URL must be an absolute HTTP(S) URL')
    }
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error(
        'A2A public base URL must use HTTP(S) and must not contain credentials',
      )
    }
    parsed.search = ''
    parsed.hash = ''
    baseUrl = parsed.toString().replace(/\/$/u, '')
  }
  const server = Bun.serve({
    hostname: options.host,
    port: options.port,
    idleTimeout: 255,
    fetch: request => handleA2ARequest(request, options, baseUrl),
  })

  // biome-ignore lint/suspicious/noConsole:: CLI command output
  console.log(`A2A server listening on http://${options.host}:${server.port}`)
  await new Promise(() => {
    // Keep process alive until interrupted.
  })
}
