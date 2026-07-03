import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import {
  backgroundDir,
  getBackgroundTask,
  listBackgroundTasks,
  readBackgroundLog,
  startBackgroundTask,
  stopBackgroundTask,
  type BackgroundTask,
} from './backgroundRunner.js'
import { verifyDelegationToken } from './delegation.js'
import { buildA2AAgentCard } from './trends.js'

export type ServeOptions = {
  host: string
  port: number
  token?: string
  /** HMAC secret that verifies attenuated A2A delegation tokens. */
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function bearerValue(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match ? match[1].trim() : null
}

export type AuthResult = { ok: boolean; reason?: string }

/**
 * Authorize a task request. A static shared-secret bearer token still works for
 * back-compat; in addition, an attenuated delegation token is accepted when its
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
  if (!hasStatic && !hasDelegation) return { ok: true }

  const bearer = bearerValue(request)
  if (!bearer) return { ok: false, reason: 'missing bearer token' }
  if (hasStatic && bearer === options.token) return { ok: true }
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
    if (result.valid) return { ok: true }
    return { ok: false, reason: result.reason }
  }
  return { ok: false, reason: 'invalid token' }
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
  mkdirSync(a2aDir(cwd), { recursive: true })
}

function loadA2AManifest(cwd: string): A2AManifest {
  const path = manifestPath(cwd)
  if (!existsSync(path)) return { version: 1, tasks: [] }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<A2AManifest>
    if (parsed && Array.isArray(parsed.tasks)) return { version: 1, tasks: parsed.tasks }
  } catch {
    // Corrupt local state should not take down the sidecar; start with an empty view.
  }
  return { version: 1, tasks: [] }
}

function saveA2AManifest(cwd: string, manifest: A2AManifest): void {
  ensureA2ADir(cwd)
  writeFileSync(manifestPath(cwd), `${JSON.stringify(manifest, null, 2)}\n`)
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
  for (const background of listBackgroundTasks(cwd)) {
    if (!background.task.startsWith('A2A delegated task:') || backgroundIds.has(background.id)) {
      continue
    }
    manifest.tasks.push({
      id: createA2AId(),
      prompt: background.task.replace(/^A2A delegated task:\s*/u, ''),
      backgroundTaskId: background.id,
      status: mapBackgroundStatus(background.status),
      mode: 'async',
      createdAt: background.createdAt,
      updatedAt: background.updatedAt,
    })
  }
  saveA2AManifest(cwd, manifest)
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
  return {
    id: decodeURIComponent(match[1] ?? ''),
    subresource: match[2] ? decodeURIComponent(match[2]) : undefined,
  }
}

function authorizeA2A(
  request: Request,
  options: ServeOptions,
  requiredScope?: string,
): Response | null {
  const auth = authorizeRequest(request, options, requiredScope)
  if (auth.ok) return null
  return jsonResponse(401, { error: 'unauthorized', reason: auth.reason })
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

async function readTaskBody(request: Request): Promise<TaskRequestBody | null> {
  return (await request.json().catch(() => null)) as TaskRequestBody | null
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

async function runSynchronousTask(
  options: ServeOptions,
  prompt: string,
  skill?: string,
): Promise<Response> {
  const command = headlessCommand(prompt)
  const createdAt = now()
  const record: A2ATaskRecord = {
    id: createA2AId(),
    prompt,
    skill,
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
  const manifest = loadA2AManifest(options.cwd)
  manifest.tasks.push(record)
  saveA2AManifest(options.cwd, manifest)
  return jsonResponse(result.code === 0 ? 200 : 500, {
    task: record,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr || result.error,
  })
}

async function startAsynchronousTask(
  options: ServeOptions,
  body: TaskRequestBody,
  prompt: string,
  skill?: string,
): Promise<Response> {
  const maxTurns =
    typeof body.maxTurns === 'number'
      ? body.maxTurns
      : typeof body.maxTurns === 'string'
        ? Number(body.maxTurns)
        : undefined
  const background = await startBackgroundTask({
    cwd: options.cwd,
    task: `A2A delegated task: ${prompt}`,
    worktree: body.worktree === true,
    model: typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined,
    maxTurns: Number.isFinite(maxTurns) && maxTurns && maxTurns > 0 ? maxTurns : undefined,
    skipPermissions: body.skipPermissions === true,
    dryRun: options.dryRun,
  })
  const createdAt = now()
  const record: A2ATaskRecord = {
    id: createA2AId(),
    prompt,
    skill,
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
    return jsonResponse(200, buildA2AAgentCard({ baseUrl }))
  }
  if (request.method === 'GET' && url.pathname === '/a2a/tasks') {
    const unauthorized = authorizeA2A(request, options)
    if (unauthorized) return unauthorized
    return jsonResponse(200, { tasks: listA2ATasks(options.cwd) })
  }
  if (request.method === 'POST' && url.pathname === '/a2a/tasks') {
    const body = await readTaskBody(request)
    const requiredScope = typeof body?.skill === 'string' ? body.skill : undefined
    const unauthorized = authorizeA2A(request, options, requiredScope)
    if (unauthorized) return unauthorized
    const prompt = typeof body?.prompt === 'string' ? body.prompt : ''
    if (!prompt.trim()) {
      return jsonResponse(400, { error: 'missing prompt' })
    }
    const skill = typeof body?.skill === 'string' ? body.skill : undefined
    if (body?.wait === true || body?.mode === 'sync') {
      return await runSynchronousTask(options, prompt, skill)
    }
    return await startAsynchronousTask(options, body ?? {}, prompt, skill)
  }
  const taskPath = taskIdFromPath(url.pathname)
  if (taskPath) {
    const unauthorized = authorizeA2A(request, options)
    if (unauthorized) return unauthorized
    const task = getA2ATask(options.cwd, taskPath.id)
    if (!task) return jsonResponse(404, { error: 'task not found' })

    if (request.method === 'GET' && !taskPath.subresource) {
      return jsonResponse(200, { task })
    }
    if (request.method === 'GET' && taskPath.subresource === 'output') {
      const background =
        task.backgroundTaskId ? getBackgroundTask(options.cwd, task.backgroundTaskId) : null
      const log =
        task.backgroundTaskId ? readBackgroundLog(options.cwd, task.backgroundTaskId) : null
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
      const canceled = updateA2ATask(options.cwd, task.id, t => {
        t.status = 'canceled'
      })
      return jsonResponse(200, { task: canceled ?? task })
    }
  }
  return jsonResponse(404, { error: 'not found' })
}

export async function serveA2A(options: ServeOptions): Promise<void> {
  if (!isLoopback(options.host) && !options.token && !options.delegationSecret) {
    throw new Error(
      'Refusing to bind a2a server off-loopback without --token or --delegation-secret',
    )
  }
  if (typeof Bun === 'undefined' || typeof Bun.serve !== 'function') {
    throw new Error('A2A server requires the Bun runtime')
  }

  const baseUrl = `http://${options.host}:${options.port}`
  const server = Bun.serve({
    hostname: options.host,
    port: options.port,
    fetch: request => handleA2ARequest(request, options, baseUrl),
  })

  // biome-ignore lint/suspicious/noConsole:: CLI command output
  console.log(`A2A server listening on http://${options.host}:${server.port}`)
  await new Promise(() => {
    // Keep process alive until interrupted.
  })
}
