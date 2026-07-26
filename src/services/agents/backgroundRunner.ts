import { spawn } from 'node:child_process'
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import {
  strictGitSubprocessEnv,
  strictSubprocessEnv,
} from '../../utils/subprocessEnv.js'
import { findCanonicalGitRoot, findGitRoot, gitExe } from '../../utils/git.js'
import { safeParseJSON } from '../../utils/json.js'
import { listModelCapabilities } from '../../commands/model-doctor/model-doctor.js'
import { resolveModelForTask } from './modelRouter.js'
import { loadModelPool } from './modelPool.js'
import { appendCommandLog } from './commandLog.js'
import { lockSync } from '../../utils/lockfile.js'
import {
  appendRunAction,
  initializeResearchTrace,
  writeRunDiff,
  writeRunReport,
} from './runArtifacts.js'

export type BackgroundTaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled'

export type BackgroundTask = {
  id: string
  task: string
  status: BackgroundTaskStatus
  cwd: string
  runCwd: string
  model?: string
  routeStrategy?: 'auto' | 'cheap' | 'strong' | 'default'
  maxTurns?: number
  skipPermissions?: boolean
  offline?: boolean
  workerPid?: number
  agentPid?: number
  exitCode?: number
  error?: string
  logFile: string
  outputFile: string
  inboxFile: string
  branch?: string
  worktree?: {
    enabled: boolean
    path?: string
    branch?: string
  }
  pr?: {
    enabled: boolean
    draft?: boolean
    base?: string
    title?: string
    body?: string
    push?: boolean
    command?: string[]
    created?: boolean
    stdout?: string
    stderr?: string
    error?: string
    trust?: {
      originUrl: string
      repository: string
      configDigest: string
      baseHead: string
    }
  }
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
}

export type BackgroundSteerResult = {
  accepted: boolean
  duplicate?: boolean
  requestId: string
  acceptedAt?: string
  reason?: string
}

export const MAX_BACKGROUND_STEERING_MESSAGE_BYTES = 64 * 1024
export const MAX_BACKGROUND_INBOX_BYTES = 8 * 1024 * 1024

type Manifest = { version: 1; tasks: BackgroundTask[] }

export type StartBackgroundTaskOptions = {
  cwd: string
  task: string
  worktree?: boolean
  pr?: boolean
  draft?: boolean
  base?: string
  title?: string
  body?: string
  push?: boolean
  model?: string
  routeStrategy?: 'auto' | 'cheap' | 'strong' | 'default'
  maxTurns?: number
  skipPermissions?: boolean
  dryRun?: boolean
  offline?: boolean
  bin?: { file: string; baseArgs: string[] }
}

export type FanoutBackgroundOptions = StartBackgroundTaskOptions & {
  agents: number
}

export type StartBackgroundTaskResult = {
  task: BackgroundTask
  command: string[]
  dryRun: boolean
}

export type StartExistingBackgroundTaskOptions = {
  dryRun?: boolean
  bin?: { file: string; baseArgs: string[] }
}

function now(): string {
  return new Date().toISOString()
}

function projectRoot(cwd: string): string {
  return findCanonicalGitRoot(cwd) ?? findGitRoot(cwd) ?? cwd
}

export function backgroundDir(cwd: string): string {
  return join(projectRoot(cwd), '.ur', 'background')
}

function manifestPath(cwd: string): string {
  return join(backgroundDir(cwd), 'tasks.json')
}

function logsDir(cwd: string): string {
  return join(backgroundDir(cwd), 'logs')
}

function outputsDir(cwd: string): string {
  return join(backgroundDir(cwd), 'outputs')
}

function inboxDir(cwd: string): string {
  return join(backgroundDir(cwd), 'inbox')
}

function worktreesDir(cwd: string): string {
  return join(projectRoot(cwd), '.ur', 'worktrees')
}

function ensureDirs(cwd: string): void {
  mkdirSync(backgroundDir(cwd), { recursive: true, mode: 0o700 })
  mkdirSync(logsDir(cwd), { recursive: true, mode: 0o700 })
  mkdirSync(outputsDir(cwd), { recursive: true, mode: 0o700 })
  mkdirSync(inboxDir(cwd), { recursive: true, mode: 0o700 })
}

function backgroundLimit(
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  if (!value || !/^\d+$/u.test(value.trim())) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback
}

function manifestLockPath(cwd: string): string {
  return join(backgroundDir(cwd), '.tasks.lock')
}

const manifestLockWaitArray = new Int32Array(new SharedArrayBuffer(4))

function acquireManifestLock(path: string): () => void {
  const attempts = 21
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return lockSync(path, {
        realpath: false,
        stale: 30_000,
      })
    } catch (error) {
      lastError = error
      if ((error as NodeJS.ErrnoException).code !== 'ELOCKED' || attempt === attempts - 1) {
        throw error
      }
      // The surrounding background-runner API is intentionally synchronous.
      // proper-lockfile's sync adapter forbids its async retry option, so use
      // a short bounded wait before retrying cross-process contention.
      Atomics.wait(manifestLockWaitArray, 0, 0, Math.min(100, 10 + attempt * 5))
    }
  }
  throw lastError
}

function withManifestLock<T>(cwd: string, operation: (root: string) => T): T {
  const root = projectRoot(cwd)
  ensureDirs(root)
  const path = manifestLockPath(root)
  try {
    const fd = openSync(path, 'wx', 0o600)
    closeSync(fd)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  const release = acquireManifestLock(path)
  try {
    return operation(root)
  } finally {
    release()
  }
}

function pathIsWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate)
  return (
    pathFromRoot === '' ||
    (pathFromRoot !== '..' &&
      !pathFromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromRoot))
  )
}

function isSafeTaskId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= 128 &&
    /^[a-zA-Z0-9_-]+$/u.test(id)
  )
}

const BACKGROUND_STATUSES = new Set<BackgroundTaskStatus>([
  'queued',
  'running',
  'completed',
  'failed',
  'canceled',
])

function normalizeManifestTask(root: string, value: unknown): BackgroundTask | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const task = value as Partial<BackgroundTask>
  if (
    !isSafeTaskId(task.id) ||
    typeof task.task !== 'string' ||
    task.task.length === 0 ||
    task.task.length > 64_000 ||
    typeof task.status !== 'string' ||
    !BACKGROUND_STATUSES.has(task.status as BackgroundTaskStatus) ||
    typeof task.createdAt !== 'string' ||
    typeof task.updatedAt !== 'string'
  ) {
    return null
  }

  const safeWorktreesRoot = resolve(worktreesDir(root))
  const requestedWorktreePath = typeof task.worktree?.path === 'string'
    ? resolve(task.worktree.path)
    : join(safeWorktreesRoot, task.id)
  const worktreePath = pathIsWithin(safeWorktreesRoot, requestedWorktreePath)
    ? requestedWorktreePath
    : join(safeWorktreesRoot, task.id)
  const requestedRunCwd = typeof task.runCwd === 'string'
    ? resolve(task.runCwd)
    : root
  const runCwd = task.worktree?.enabled && pathIsWithin(safeWorktreesRoot, requestedRunCwd)
    ? requestedRunCwd
    : root
  const worktree = task.worktree?.enabled
    ? {
        ...task.worktree,
        path: worktreePath,
      }
    : task.worktree

  const normalized: BackgroundTask = {
    ...(task as BackgroundTask),
    id: task.id,
    task: task.task,
    status: task.status as BackgroundTaskStatus,
    cwd: root,
    runCwd,
    logFile: join(logsDir(root), `${task.id}.log`),
    outputFile: join(outputsDir(root), `${task.id}.json`),
    inboxFile: join(inboxDir(root), `${task.id}.jsonl`),
    worktree,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }
  if (
    normalized.status === 'completed' ||
    normalized.status === 'failed' ||
    normalized.status === 'canceled'
  ) {
    delete normalized.workerPid
    delete normalized.agentPid
  }
  return normalized
}

function loadManifest(cwd: string): Manifest {
  const root = projectRoot(cwd)
  const path = manifestPath(root)
  if (!existsSync(path)) return { version: 1, tasks: [] }
  const maxBytes = backgroundLimit(
    process.env.UR_BACKGROUND_MAX_MANIFEST_BYTES,
    16 * 1024 * 1024,
    64 * 1024 * 1024,
  )
  const fd = openSync(path, 'r')
  let text: string
  try {
    const buffer = Buffer.allocUnsafe(maxBytes + 1)
    let bytesRead = 0
    while (bytesRead < buffer.length) {
      const count = readSync(
        fd,
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        bytesRead,
      )
      if (count === 0) break
      bytesRead += count
    }
    if (bytesRead > maxBytes) {
      throw new Error(`Background task manifest exceeds ${maxBytes} bytes: ${path}`)
    }
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(
        buffer.subarray(0, bytesRead),
      )
    } catch {
      throw new Error(`Background task manifest is not valid UTF-8: ${path}`)
    }
  } finally {
    closeSync(fd)
  }
  const parsed = safeParseJSON(text, false)
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as { version?: unknown }).version !== 1 ||
    !Array.isArray((parsed as Manifest).tasks)
  ) {
    throw new Error(`Background task manifest is invalid: ${path}`)
  }
  const rawTasks = (parsed as Manifest).tasks
  const maxTasks = backgroundLimit(
    process.env.UR_BACKGROUND_MAX_TASKS,
    5_000,
    20_000,
  )
  if (rawTasks.length > maxTasks) {
    throw new Error(`Background task manifest exceeds ${maxTasks} tasks: ${path}`)
  }
  const tasks = rawTasks.map(task => normalizeManifestTask(root, task))
  if (tasks.some(task => task === null)) {
    throw new Error(`Background task manifest contains an invalid task: ${path}`)
  }
  return { version: 1, tasks: tasks as BackgroundTask[] }
}

function saveManifest(cwd: string, manifest: Manifest): void {
  const root = projectRoot(cwd)
  ensureDirs(root)
  const path = manifestPath(root)
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  const content = `${JSON.stringify(manifest, null, 2)}\n`
  const maxBytes = backgroundLimit(
    process.env.UR_BACKGROUND_MAX_MANIFEST_BYTES,
    16 * 1024 * 1024,
    64 * 1024 * 1024,
  )
  if (Buffer.byteLength(content, 'utf8') > maxBytes) {
    throw new Error(`Background task manifest would exceed ${maxBytes} bytes`)
  }
  let fd: number | undefined
  try {
    fd = openSync(tempPath, 'wx', 0o600)
    writeFileSync(fd, content, 'utf8')
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(tempPath, path)
  } finally {
    if (fd !== undefined) closeSync(fd)
    rmSync(tempPath, { force: true })
  }
}

function updateTask(
  cwd: string,
  id: string,
  fn: (task: BackgroundTask) => void,
): BackgroundTask | null {
  if (!isSafeTaskId(id)) return null
  return withManifestLock(cwd, root => {
    const manifest = loadManifest(root)
    const task = manifest.tasks.find(t => t.id === id)
    if (!task) return null
    fn(task)
    task.updatedAt = now()
    saveManifest(root, manifest)
    return task
  })
}

function makeId(): string {
  return `bg_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`
}

function slug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36) || 'task'
}

function cliEntry(bin?: { file: string; baseArgs: string[] }): {
  file: string
  baseArgs: string[]
} {
  return {
    file: bin?.file ?? process.execPath,
    baseArgs: bin?.baseArgs ?? [process.argv[1] ?? ''],
  }
}

function quote(arg: string): string {
  return /^[a-zA-Z0-9_./:=@+-]+$/.test(arg) ? arg : JSON.stringify(arg)
}

function formatCommand(args: string[]): string {
  return args.map(quote).join(' ')
}

export function listBackgroundTasks(cwd: string): BackgroundTask[] {
  return loadManifest(cwd).tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function getBackgroundTask(cwd: string, id: string): BackgroundTask | null {
  return loadManifest(cwd).tasks.find(t => t.id === id) ?? null
}

export function readBackgroundLog(
  cwd: string,
  id: string,
  tailLines?: number,
  maxBytes?: number,
): string | null {
  const task = getBackgroundTask(cwd, id)
  if (!task || !existsSync(task.logFile)) return null
  let text: string
  const size = statSync(task.logFile).size
  if (
    typeof maxBytes === 'number' &&
    Number.isSafeInteger(maxBytes) &&
    maxBytes > 0 &&
    size > maxBytes
  ) {
    const fd = openSync(task.logFile, 'r')
    try {
      const buffer = Buffer.allocUnsafe(maxBytes)
      const bytesRead = readSync(fd, buffer, 0, maxBytes, size - maxBytes)
      text = buffer.subarray(0, bytesRead).toString('utf8')
      // The byte window can begin in the middle of a UTF-8 sequence or log
      // line. Drop the leading fragment so network responses contain complete
      // records and never need to load the entire log into memory.
      const firstNewline = text.indexOf('\n')
      if (firstNewline !== -1) text = text.slice(firstNewline + 1)
    } finally {
      closeSync(fd)
    }
  } else {
    text = readFileSync(task.logFile, 'utf-8')
  }
  if (!tailLines || tailLines <= 0) return text
  const hadTrailingNewline = text.endsWith('\n')
  const lines = text.split('\n')
  if (hadTrailingNewline) lines.pop()
  const tail = lines.slice(-tailLines).join('\n')
  return hadTrailingNewline && tail ? `${tail}\n` : tail
}

export function appendBackgroundFeedback(
  cwd: string,
  id: string,
  text: string,
  source?: { artifactId?: string; actor?: string; requestId?: string },
): BackgroundTask | null {
  const result = steerBackgroundTask(cwd, id, text, source)
  return result.accepted ? getBackgroundTask(cwd, id) : null
}

/**
 * Append one bounded, idempotent steering event to a live background task.
 * The request id is persisted in the inbox itself, so retries remain safe
 * across CLI restarts without adding another mutable index.
 */
export function steerBackgroundTask(
  cwd: string,
  id: string,
  text: string,
  source?: { artifactId?: string; actor?: string; requestId?: string },
): BackgroundSteerResult {
  const requestId = source?.requestId ?? randomUUID()
  if (
    requestId.length < 1 ||
    requestId.length > 128 ||
    !/^[a-zA-Z0-9_-]+$/u.test(requestId)
  ) {
    return {
      accepted: false,
      requestId,
      reason:
        'request id must contain only letters, digits, underscores, or dashes (max 128 characters)',
    }
  }
  const task = getBackgroundTask(cwd, id)
  if (!task) {
    return { accepted: false, requestId, reason: 'task not found' }
  }
  if (task.status !== 'queued' && task.status !== 'running') {
    return {
      accepted: false,
      requestId,
      reason: `task is ${task.status}`,
    }
  }
  const message = text.trim()
  const messageBytes = Buffer.byteLength(message, 'utf8')
  if (
    messageBytes < 1 ||
    messageBytes > MAX_BACKGROUND_STEERING_MESSAGE_BYTES
  ) {
    return {
      accepted: false,
      requestId,
      reason: 'message must be between 1 byte and 64 KiB',
    }
  }
  const messageSha256 = createHash('sha256').update(message).digest('hex')

  ensureDirs(task.cwd)
  const lockPath = `${task.inboxFile}.lock`
  writeFileSync(lockPath, '', { flag: 'a', mode: 0o600 })
  const release = acquireManifestLock(lockPath)
  const at = now()
  try {
    const existing = existsSync(task.inboxFile)
      ? readFileSync(task.inboxFile)
      : Buffer.alloc(0)
    if (existing.length > MAX_BACKGROUND_INBOX_BYTES) {
      return {
        accepted: false,
        requestId,
        reason: 'steering inbox reached its 8 MiB limit',
      }
    }
    for (const line of existing.toString('utf8').split('\n')) {
      const parsed = safeParseJSON(line.trim(), false) as
        | {
            requestId?: unknown
            at?: unknown
            messageSha256?: unknown
          }
        | null
      if (parsed?.requestId === requestId) {
        const sameMessage =
          typeof parsed.messageSha256 !== 'string' ||
          parsed.messageSha256 === messageSha256
        return {
          accepted: sameMessage,
          duplicate: true,
          requestId,
          acceptedAt:
            typeof parsed.at === 'string' ? parsed.at : undefined,
          ...(!sameMessage
            ? {
                reason:
                  'request id was already used for a different message',
              }
            : {}),
        }
      }
    }
    const entry = {
      at,
      type: source?.artifactId ? 'artifact-feedback' : 'steering',
      requestId,
      messageSha256,
      artifactId: source?.artifactId,
      actor: source?.actor?.slice(0, 256),
      text: message,
    }
    const serialized = `${JSON.stringify(entry)}\n`
    if (
      existing.length + Buffer.byteLength(serialized, 'utf8') >
      MAX_BACKGROUND_INBOX_BYTES
    ) {
      return {
        accepted: false,
        requestId,
        reason: 'steering inbox reached its 8 MiB limit',
      }
    }
    writeFileSync(task.inboxFile, serialized, {
      flag: 'a',
      mode: 0o600,
    })
  } finally {
    release()
  }

  writeFileSync(
    task.logFile,
    `[${at}] accepted steering ${requestId}${source?.artifactId ? ` from artifact ${source.artifactId.replace(/[\r\n\u0000]/gu, '').slice(0, 80)}` : ''}${source?.actor ? ` by ${source.actor.replace(/[\r\n\u0000]/gu, '').slice(0, 80)}` : ''}\n`,
    { flag: 'a', mode: 0o600 },
  )
  updateTask(cwd, id, t => {
    t.updatedAt = at
  })
  return { accepted: true, requestId, acceptedAt: at }
}

export function readBackgroundInbox(cwd: string, id: string): string | null {
  const task = getBackgroundTask(cwd, id)
  if (!task || !existsSync(task.inboxFile)) return null
  return readFileSync(task.inboxFile, 'utf-8')
}

export function createBackgroundTask(
  options: StartBackgroundTaskOptions,
): BackgroundTask {
  if (options.pr && !options.worktree) {
    throw new Error(
      'Background pull requests require --worktree so unrelated working-tree changes cannot be committed.',
    )
  }
  const root = projectRoot(options.cwd)
  ensureDirs(root)
  const id = makeId()
  const createdAt = now()
  const branch = options.worktree ? `ur/bg-${id}-${slug(options.task)}` : undefined
  const task: BackgroundTask = {
    id,
    task: options.task,
    status: 'queued',
    cwd: root,
    runCwd: root,
    model: options.model,
    routeStrategy: options.routeStrategy,
    maxTurns: options.maxTurns,
    skipPermissions: options.skipPermissions,
    logFile: join(logsDir(root), `${id}.log`),
    outputFile: join(outputsDir(root), `${id}.json`),
    inboxFile: join(inboxDir(root), `${id}.jsonl`),
    branch,
    worktree: options.worktree
      ? { enabled: true, branch, path: join(worktreesDir(root), branch ?? id) }
      : undefined,
    pr: options.pr
      ? {
          enabled: true,
          draft: options.draft,
          base: options.base,
          title: options.title,
          body: options.body,
          push: options.push ?? true,
        }
      : undefined,
    offline: options.offline,
    createdAt,
    updatedAt: createdAt,
  }
  withManifestLock(root, lockedRoot => {
    const manifest = loadManifest(lockedRoot)
    const maxTasks = backgroundLimit(
      process.env.UR_BACKGROUND_MAX_TASKS,
      5_000,
      20_000,
    )
    if (manifest.tasks.length >= maxTasks) {
      throw new Error(
        `Background task limit reached (${maxTasks}); archive the existing .ur/background data before starting more tasks.`,
      )
    }
    manifest.tasks.push(task)
    saveManifest(lockedRoot, manifest)
  })
  initializeResearchTrace(root, id, {
    kind: 'background-task',
    status: 'planned',
    task: options.task,
    worktree: options.worktree ?? false,
    pr: options.pr ?? false,
    model: options.model,
    routeStrategy: options.routeStrategy,
    offline: options.offline ?? false,
  })
  appendRunAction(root, id, {
    kind: 'background-task-created',
    title: options.task,
    status: 'planned',
    reason: 'create detached local UR background task',
    nextAction: options.dryRun ? 'report planned worker command' : 'spawn background worker',
    data: { task },
  })
  return task
}

function buildWorkerCommand(
  task: BackgroundTask,
  bin?: { file: string; baseArgs: string[] },
): { entry: { file: string; baseArgs: string[] }; command: string[] } {
  const entry = cliEntry(bin)
  return {
    entry,
    command: [...entry.baseArgs, 'bg', 'worker', task.id],
  }
}

async function resolveTaskEnv(task: BackgroundTask): Promise<NodeJS.ProcessEnv> {
  const base = { ...process.env }
  // The detached UR parent may keep provider credentials for model access, but
  // every repository-controlled child command/tool it launches must receive a
  // scrubbed environment.
  base.UR_CODE_SUBPROCESS_ENV_SCRUB = '1'
  const model = task.model ?? (await resolveRouteStrategyModel(task))
  if (model) {
    base.UR_MODEL = model
    base.OLLAMA_MODEL = model
  }
  if ((task as { offline?: boolean }).offline) {
    base.UR_OFFLINE = '1'
  }
  return base
}

async function resolveRouteStrategyModel(task: BackgroundTask): Promise<string | undefined> {
  const strategy = task.routeStrategy
  if (!strategy) return undefined
  const { models } = await listModelCapabilities()
  return resolveModelForTask(task.task, strategy, loadModelPool(task.cwd), models, {
    localOnly: task.offline ?? false,
    cwd: task.cwd,
  })
}

async function spawnBackgroundWorker(
  task: BackgroundTask,
  bin?: { file: string; baseArgs: string[] },
): Promise<string[]> {
  const { entry, command } = buildWorkerCommand(task, bin)
  const out = openSync(task.logFile, 'a', 0o600)
  const err = openSync(task.logFile, 'a', 0o600)
  try {
    const env = await resolveTaskEnv(task)
    const child = spawn(entry.file, command, {
      cwd: task.cwd,
      detached: true,
      stdio: ['ignore', out, err],
      env,
    })
    child.on('error', error => {
      appendCommandLog(task.cwd, task.id, {
        command: formatCommand([entry.file, ...command]),
        exitCode: 1,
        stdout: '',
        stderr: error.message,
        reason: 'spawn detached background worker process',
        nextAction: 'inspect worker spawn failure before retrying',
      })
      updateTask(task.cwd, task.id, t => {
        if (t.status !== 'queued' && t.status !== 'running') return
        t.status = 'failed'
        t.error = error.message
        t.completedAt = now()
        delete t.workerPid
        delete t.agentPid
      })
    })
    child.unref()
    let shouldTerminate = false
    updateTask(task.cwd, task.id, t => {
      if (t.status === 'queued' || t.status === 'running') {
        t.workerPid = child.pid
      } else if (t.status === 'canceled') {
        shouldTerminate = true
      }
    })
    if (shouldTerminate) {
      try {
        child.kill('SIGTERM')
      } catch {
        // The newly spawned worker may already have exited.
      }
    }
    appendCommandLog(task.cwd, task.id, {
      command: formatCommand([entry.file, ...command]),
      exitCode: 0,
      stdout: '',
      stderr: '',
      reason: 'spawn detached background worker process',
      nextAction: 'monitor background task log and output files',
    })
  } finally {
    closeSync(out)
    closeSync(err)
  }
  return [entry.file, ...command]
}

export async function startBackgroundTask(
  options: StartBackgroundTaskOptions,
): Promise<StartBackgroundTaskResult> {
  const task = createBackgroundTask(options)
  const { entry, command } = buildWorkerCommand(task, options.bin)
  if (options.dryRun) {
    return { task, command: [entry.file, ...command], dryRun: true }
  }

  await spawnBackgroundWorker(task, options.bin)

  return { task, command: [entry.file, ...command], dryRun: false }
}

export async function startExistingBackgroundTask(
  cwd: string,
  id: string,
  options: StartExistingBackgroundTaskOptions = {},
): Promise<StartBackgroundTaskResult | null> {
  const task = getBackgroundTask(cwd, id)
  if (!task) return null
  const { entry, command } = buildWorkerCommand(task, options.bin)
  if (options.dryRun) {
    return { task, command: [entry.file, ...command], dryRun: true }
  }
  await spawnBackgroundWorker(task, options.bin)
  return { task, command: [entry.file, ...command], dryRun: false }
}

export async function fanoutBackgroundTasks(
  options: FanoutBackgroundOptions,
): Promise<StartBackgroundTaskResult[]> {
  const count = Math.max(1, Math.min(32, Math.floor(options.agents || 1)))
  const results: StartBackgroundTaskResult[] = []
  for (let i = 1; i <= count; i++) {
    results.push(
      await startBackgroundTask({
        ...options,
        task:
          count === 1
            ? options.task
            : `Candidate ${i}/${count}: ${options.task}`,
      }),
    )
  }
  return results
}

async function git(
  cwd: string,
  args: string[],
  timeout = 60_000,
): Promise<{ stdout: string; stderr: string; code: number; error?: string }> {
  return execFileNoThrowWithCwd(gitExe(), [
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'diff.external=',
    ...args,
  ], {
    cwd,
    timeout,
    preserveOutputOnError: true,
    env: strictGitSubprocessEnv(),
    extendEnv: false,
  })
}

async function setupWorktree(task: BackgroundTask): Promise<string> {
  if (!task.worktree?.enabled) return task.cwd
  const root = resolve(worktreesDir(task.cwd))
  const path = resolve(task.worktree.path ?? join(root, task.id))
  const branch = task.worktree.branch ?? `ur/bg-${task.id}`
  mkdirSync(root, { recursive: true, mode: 0o700 })
  if (!pathIsWithin(root, path)) {
    throw new Error(`Refusing background worktree path outside ${root}`)
  }
  if (existsSync(path)) {
    const canonicalRoot = realpathSync(root)
    const canonicalPath = realpathSync(path)
    if (
      lstatSync(path).isSymbolicLink() ||
      !pathIsWithin(canonicalRoot, canonicalPath)
    ) {
      throw new Error(`Refusing unsafe background worktree path: ${path}`)
    }
  }
  if (!existsSync(path)) {
    const requestedBase = task.pr?.enabled
      ? task.pr.base ?? 'HEAD'
      : 'HEAD'
    if (
      requestedBase.startsWith('-') ||
      requestedBase.length > 512 ||
      /[\0\r\n]/u.test(requestedBase)
    ) {
      throw new Error('Invalid background PR base ref.')
    }
    const filters = await git(
      task.cwd,
      ['config', '--get-regexp', '^filter\\..*\\.(clean|process)$'],
      60_000,
    )
    if (filters.code === 0 && filters.stdout.trim()) {
      throw new Error(
        'Background worktrees refuse repositories with local Git clean/process filters.',
      )
    }
    if (filters.code !== 0 && filters.code !== 1) {
      throw new Error('Could not inspect Git filters before worktree creation.')
    }
    const resolvedBase = await git(
      task.cwd,
      ['rev-parse', '--verify', `${requestedBase}^{commit}`],
      60_000,
    )
    const baseHead = resolvedBase.stdout.trim()
    if (
      resolvedBase.code !== 0 ||
      !/^[a-f0-9]{40,64}$/iu.test(baseHead)
    ) {
      throw new Error(
        resolvedBase.stderr ||
          resolvedBase.error ||
          `Could not resolve background base ${requestedBase}`,
      )
    }
    const result = await git(
      task.cwd,
      ['worktree', 'add', '-b', branch, path, baseHead],
      120_000,
    )
    if (result.code !== 0) {
      throw new Error(result.stderr || result.error || `git worktree add failed for ${path}`)
    }
  }
  if (!pathIsWithin(realpathSync(root), realpathSync(path))) {
    throw new Error(`Background worktree resolved outside ${root}`)
  }
  updateTask(task.cwd, task.id, t => {
    t.runCwd = path
    t.worktree = { enabled: true, path, branch }
    t.branch = branch
  })
  return path
}

function childPrompt(task: BackgroundTask): string {
  const lines = [
    task.task,
    '',
    'UR background-agent instructions:',
    '- Work locally in this repository and keep UR identity intact.',
    '- Prefer small, reviewable commits and run relevant checks before finishing.',
    '- If this run has a worktree, do not touch the original checkout.',
  ]
  if (task.pr?.enabled) {
    lines.push(
      '- This run is expected to produce a pull request; leave the branch ready for PR creation.',
    )
  }
  lines.push(`- Background task id: ${task.id}`)
  lines.push(
    `- Live steering inbox: ${task.inboxFile}. If it exists or changes, incorporate the latest feedback before finalizing.`,
  )
  return lines.join('\n')
}

export function streamUserMessage(content: string, priority: 'now' | 'later' = 'later'): string {
  return `${JSON.stringify({
    type: 'user',
    session_id: '',
    message: { role: 'user', content },
    parent_tool_use_id: null,
    uuid: randomUUID(),
    priority,
  })}\n`
}

type InboxEntry = {
  at?: string
  type?: string
  requestId?: string
  artifactId?: string
  actor?: string
  text?: string
}

export function formatInboxSteering(entry: InboxEntry): string | null {
  if (!entry.text?.trim()) return null
  const source = entry.artifactId ? ` on artifact ${entry.artifactId}` : ''
  return [
    `Live steering feedback${source}:`,
    entry.text.trim(),
    '',
    'Incorporate this feedback into the current background task. If you are in the middle of an approach that conflicts with this feedback, adjust course before finalizing.',
  ].join('\n')
}

export function readInboxEntriesFromOffset(file: string, offset: number): {
  nextOffset: number
  entries: InboxEntry[]
} {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_BACKGROUND_INBOX_BYTES) {
    throw new Error('Invalid background steering inbox offset.')
  }
  if (!existsSync(file)) return { nextOffset: offset, entries: [] }
  const lockPath = `${file}.lock`
  writeFileSync(lockPath, '', { flag: 'a', mode: 0o600 })
  const release = acquireManifestLock(lockPath)
  try {
    const before = lstatSync(file)
    if (before.isSymbolicLink() || !before.isFile()) {
      throw new Error('Unsafe background steering inbox.')
    }
    if (before.size > MAX_BACKGROUND_INBOX_BYTES) {
      throw new Error('Background steering inbox exceeds its 8 MiB limit.')
    }
    if (before.size <= offset) {
      return { nextOffset: before.size, entries: [] }
    }
    const noFollow = constants.O_NOFOLLOW ?? 0
    const fd = openSync(file, constants.O_RDONLY | noFollow)
    let buffer: Buffer
    let bytesRead = 0
    let after: ReturnType<typeof fstatSync>
    try {
      buffer = Buffer.allocUnsafe(before.size - offset)
      while (bytesRead < buffer.length) {
        const read = readSync(
          fd,
          buffer,
          bytesRead,
          buffer.length - bytesRead,
          offset + bytesRead,
        )
        if (read === 0) break
        bytesRead += read
      }
      after = fstatSync(fd)
    } finally {
      closeSync(fd)
    }
    if (
      !after.isFile() ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size
    ) {
      throw new Error('Background steering inbox changed while reading.')
    }
    const complete = buffer.subarray(0, bytesRead)
    const lastNewline = complete.lastIndexOf(0x0a)
    if (lastNewline === -1) return { nextOffset: offset, entries: [] }
    const entries: InboxEntry[] = []
    for (const line of complete.subarray(0, lastNewline + 1).toString('utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || Buffer.byteLength(trimmed, 'utf8') > MAX_BACKGROUND_STEERING_MESSAGE_BYTES + 4_096) {
        continue
      }
      const parsed = safeParseJSON(trimmed, false)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      const entry = parsed as InboxEntry
      if (
        typeof entry.text !== 'string' ||
        Buffer.byteLength(entry.text.trim(), 'utf8') < 1 ||
        Buffer.byteLength(entry.text.trim(), 'utf8') >
          MAX_BACKGROUND_STEERING_MESSAGE_BYTES
      ) {
        continue
      }
      if (
        entry.requestId !== undefined &&
        (typeof entry.requestId !== 'string' ||
          entry.requestId.length < 1 ||
          entry.requestId.length > 128 ||
          !/^[a-zA-Z0-9_-]+$/u.test(entry.requestId))
      ) {
        continue
      }
      entries.push(entry)
    }
    return { nextOffset: offset + lastNewline + 1, entries }
  } finally {
    release()
  }
}

async function runHeadlessAgent(task: BackgroundTask, cwd: string): Promise<number> {
  const entry = cliEntry()
  const args = [
    ...entry.baseArgs,
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
  ]
  if (task.maxTurns && task.maxTurns > 0) args.push('--max-turns', String(task.maxTurns))
  if (task.skipPermissions) args.push('--dangerously-skip-permissions')

  const env = {
    ...process.env,
    UR_CODE_SUBPROCESS_ENV_SCRUB: '1',
    ...(task.model
      ? { UR_MODEL: task.model, OLLAMA_MODEL: task.model }
      : {}),
  }

  return await new Promise(resolve => {
    const outputFd = openSync(task.outputFile, 'a', 0o600)
    const logFd = openSync(task.logFile, 'a', 0o600)
    // Steering can arrive after task creation but before the headless child
    // starts. Begin at zero so that backlog is deterministically delivered.
    let inboxOffset = 0
    let sawResult = false
    let closedInput = false
    let cleanedUp = false
    let inboxFailed = false
    let closeTimer: ReturnType<typeof setTimeout> | undefined
    let interval: ReturnType<typeof setInterval> | undefined

    const closeInputSoon = () => {
      if (closedInput) return
      if (closeTimer) clearTimeout(closeTimer)
      closeTimer = setTimeout(() => {
        if (closedInput) return
        closedInput = true
        child.stdin.end()
      }, 1000)
    }

    const writeSteering = (text: string) => {
      if (closedInput || child.stdin.destroyed) return
      if (closeTimer) {
        clearTimeout(closeTimer)
        closeTimer = undefined
      }
      child.stdin.write(streamUserMessage(text, 'now'))
      writeFileSync(task.logFile, `[${now()}] injected live steering into agent stdin\n`, {
        flag: 'a',
        mode: 0o600,
      })
      sawResult = false
    }

    const pumpInbox = () => {
      if (inboxFailed) return
      try {
        if (getBackgroundTask(task.cwd, task.id)?.status === 'canceled') {
          inboxFailed = true
          if (interval) clearInterval(interval)
          closedInput = true
          child.stdin.destroy()
          child.kill('SIGTERM')
          return
        }
        const read = readInboxEntriesFromOffset(task.inboxFile, inboxOffset)
        inboxOffset = read.nextOffset
        for (const entry of read.entries) {
          const steering = formatInboxSteering(entry)
          if (steering) writeSteering(steering)
        }
        if (sawResult) closeInputSoon()
      } catch (error) {
        inboxFailed = true
        if (interval) clearInterval(interval)
        const message =
          error instanceof Error ? error.message : String(error)
        writeFileSync(
          task.logFile,
          `[${now()}] steering inbox failed closed: ${message.replace(/[\r\n]/gu, ' ').slice(0, 1_000)}\n`,
          { flag: 'a', mode: 0o600 },
        )
        closedInput = true
        child.stdin.destroy()
        child.kill('SIGTERM')
      }
    }

    const child = spawn(entry.file, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    })
    updateTask(task.cwd, task.id, t => {
      t.agentPid = child.pid
    })
    child.stdin.write(streamUserMessage(childPrompt(task), 'later'))
    interval = setInterval(pumpInbox, 500)

    let stdoutBuffer = ''
    child.stdout.on('data', chunk => {
      const text = Buffer.from(chunk).toString('utf-8')
      writeFileSync(outputFd, text)
      stdoutBuffer += text
      for (;;) {
        const newline = stdoutBuffer.indexOf('\n')
        if (newline === -1) break
        const line = stdoutBuffer.slice(0, newline)
        stdoutBuffer = stdoutBuffer.slice(newline + 1)
        const parsed = safeParseJSON(line, false)
        if (parsed && typeof parsed === 'object' && (parsed as { type?: string }).type === 'result') {
          sawResult = true
          pumpInbox()
        }
      }
    })
    child.stderr.on('data', chunk => {
      writeFileSync(logFd, Buffer.from(chunk).toString('utf-8'))
    })
    const cleanup = () => {
      if (cleanedUp) return
      cleanedUp = true
      if (interval) clearInterval(interval)
      if (closeTimer) clearTimeout(closeTimer)
      closeSync(outputFd)
      closeSync(logFd)
      updateTask(task.cwd, task.id, t => {
        if (t.agentPid === child.pid) delete t.agentPid
      })
    }

    child.on('error', error => {
      writeFileSync(task.logFile, `\n[agent spawn error] ${error.message}\n`, {
        flag: 'a',
        mode: 0o600,
      })
      cleanup()
      appendCommandLog(task.cwd, task.id, {
        command: formatCommand([entry.file, ...args]),
        exitCode: 1,
        stdout: '',
        stderr: error.message,
        reason: 'run background headless agent',
        nextAction: 'mark task failed and inspect background spawn error',
      })
      resolve(1)
    })
    child.on('close', code => {
      cleanup()
      appendCommandLog(task.cwd, task.id, {
        command: formatCommand([entry.file, ...args]),
        exitCode: code ?? 1,
        stdout: existsSync(task.outputFile) ? readFileSync(task.outputFile, 'utf-8').slice(-16_000) : '',
        stderr: existsSync(task.logFile) ? readFileSync(task.logFile, 'utf-8').slice(-8_000) : '',
        reason: 'run background headless agent',
        nextAction: (code ?? 1) === 0
          ? 'create PR if requested and mark task completed'
          : 'mark task failed and inspect background log',
      })
      resolve(code ?? 1)
    })
  })
}

function assertBackgroundTaskNotCanceled(task: BackgroundTask): void {
  if (getBackgroundTask(task.cwd, task.id)?.status === 'canceled') {
    throw new Error(`Background task canceled: ${task.id}`)
  }
}

async function runCancelableBackgroundCommand(
  task: BackgroundTask,
  file: string,
  args: string[],
  cwd: string,
  timeout: number,
  options: { audit?: false; isolateGitConfig?: boolean } = {},
): Promise<{ stdout: string; stderr: string; code: number; error?: string }> {
  assertBackgroundTaskNotCanceled(task)
  const controller = new AbortController()
  const watcher = setInterval(() => {
    if (getBackgroundTask(task.cwd, task.id)?.status === 'canceled') {
      controller.abort()
    }
  }, 100)
  try {
    const allowPlatformAuth =
      file === 'gh' || file.endsWith('/gh') || file.endsWith('\\gh.exe')
    const isGit =
      file === gitExe() ||
      file.endsWith('/git') ||
      file.endsWith('\\git.exe')
    const allowedSecrets = allowPlatformAuth
      ? [
          'GH_TOKEN',
          'GITHUB_TOKEN',
          'GH_ENTERPRISE_TOKEN',
          'GITHUB_ENTERPRISE_TOKEN',
        ]
      : []
    const result = await execFileNoThrowWithCwd(file, args, {
      cwd,
      timeout,
      preserveOutputOnError: true,
      abortSignal: controller.signal,
      env:
        isGit && options.isolateGitConfig !== false
          ? strictGitSubprocessEnv(process.env, allowedSecrets)
          : strictSubprocessEnv(process.env, allowedSecrets),
      extendEnv: false,
      audit: options.audit,
    })
    assertBackgroundTaskNotCanceled(task)
    return result
  } finally {
    clearInterval(watcher)
  }
}

const SAFE_GIT_CONFIG_ARGS = [
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'diff.external=',
]

function githubRepositoryFromRemote(remote: string): string | null {
  if (
    !remote ||
    remote.startsWith('-') ||
    /[\0\r\n]/u.test(remote)
  ) {
    return null
  }
  const scp = /^(?:git@)?([^:/\s]+):([^/\s]+)\/([^/\s]+?)(?:\.git)?$/u.exec(
    remote,
  )
  if (scp) {
    const host = scp[1]!.toLowerCase()
    const slug = `${scp[2]}/${scp[3]}`
    return host === 'github.com' ? slug : `${host}/${slug}`
  }
  try {
    const url = new URL(remote)
    if (!['https:', 'ssh:'].includes(url.protocol) || url.password) return null
    if (
      (url.protocol === 'https:' && url.username) ||
      (url.protocol === 'ssh:' && url.username && url.username !== 'git')
    ) {
      return null
    }
    const parts = url.pathname
      .replace(/^\/+|\/+$/gu, '')
      .replace(/\.git$/u, '')
      .split('/')
    if (
      parts.length !== 2 ||
      parts.some(part => !/^[a-zA-Z0-9_.-]+$/u.test(part))
    ) {
      return null
    }
    const slug = parts.join('/')
    return url.hostname.toLowerCase() === 'github.com'
      ? slug
      : `${url.hostname.toLowerCase()}/${slug}`
  } catch {
    return null
  }
}

async function readPrTrustValue(
  task: BackgroundTask,
  cwd: string,
  args: string[],
): Promise<string> {
  const result = await runCancelableBackgroundCommand(
    task,
    gitExe(),
    [...SAFE_GIT_CONFIG_ARGS, ...args],
    cwd,
    60_000,
    { audit: false },
  )
  if (result.code !== 0) {
    throw new Error(result.stderr || result.error || `git ${args[0]} failed`)
  }
  return result.stdout.trim()
}

export async function establishPrTrust(
  task: BackgroundTask,
  cwd: string,
): Promise<NonNullable<NonNullable<BackgroundTask['pr']>['trust']>> {
  const originUrl = await readPrTrustValue(
    task,
    cwd,
    ['remote', 'get-url', '--push', 'origin'],
  )
  const repository = githubRepositoryFromRemote(originUrl)
  if (!repository) {
    throw new Error(
      'Automatic background PRs require a credential-free GitHub origin URL.',
    )
  }
  const config = await readPrTrustValue(
    task,
    cwd,
    ['config', '--null', '--list', '--show-origin'],
  )
  const filters = await runCancelableBackgroundCommand(
    task,
    gitExe(),
    [
      ...SAFE_GIT_CONFIG_ARGS,
      'config',
      '--get-regexp',
      '^filter\\..*\\.(clean|process)$',
    ],
    cwd,
    60_000,
    { audit: false },
  )
  if (filters.code === 0 && filters.stdout.trim()) {
    throw new Error(
      'Automatic background PRs refuse repositories with configured Git clean/process filters.',
    )
  }
  if (filters.code !== 0 && filters.code !== 1) {
    throw new Error('Could not inspect Git filters before background PR creation.')
  }
  const baseHead = await readPrTrustValue(task, cwd, ['rev-parse', 'HEAD'])
  if (!/^[a-f0-9]{40,64}$/iu.test(baseHead)) {
    throw new Error('Could not pin the background PR base commit.')
  }
  return {
    originUrl,
    repository,
    configDigest: createHash('sha256').update(config).digest('hex'),
    baseHead,
  }
}

async function validatePrTrust(
  task: BackgroundTask,
  cwd: string,
): Promise<NonNullable<NonNullable<BackgroundTask['pr']>['trust']>> {
  const trust = task.pr?.trust
  if (
    !trust ||
    !/^[a-f0-9]{64}$/u.test(trust.configDigest) ||
    !/^[a-f0-9]{40,64}$/iu.test(trust.baseHead)
  ) {
    throw new Error('Background PR trust state is missing or invalid.')
  }
  const originUrl = await readPrTrustValue(
    task,
    cwd,
    ['remote', 'get-url', '--push', 'origin'],
  )
  const config = await readPrTrustValue(
    task,
    cwd,
    ['config', '--null', '--list', '--show-origin'],
  )
  const branch = await readPrTrustValue(
    task,
    cwd,
    ['symbolic-ref', '--quiet', '--short', 'HEAD'],
  )
  const configDigest = createHash('sha256').update(config).digest('hex')
  if (
    originUrl !== trust.originUrl ||
    githubRepositoryFromRemote(originUrl) !== trust.repository ||
    configDigest !== trust.configDigest ||
    branch !== task.branch
  ) {
    throw new Error(
      'Repository trust state changed during the background run; refusing to publish.',
    )
  }
  const ancestor = await runCancelableBackgroundCommand(
    task,
    gitExe(),
    [
      ...SAFE_GIT_CONFIG_ARGS,
      'merge-base',
      '--is-ancestor',
      trust.baseHead,
      'HEAD',
    ],
    cwd,
    60_000,
    { audit: false },
  )
  if (ancestor.code !== 0) {
    throw new Error(
      'Background branch no longer descends from its pinned base commit.',
    )
  }
  return trust
}

export async function commitIfNeeded(task: BackgroundTask, cwd: string): Promise<void> {
  const status = await runCancelableBackgroundCommand(
    task,
    gitExe(),
    [...SAFE_GIT_CONFIG_ARGS, 'status', '--porcelain'],
    cwd,
    60_000,
  )
  if (status.code !== 0 || !status.stdout.trim()) return
  const add = await runCancelableBackgroundCommand(
    task,
    gitExe(),
    [...SAFE_GIT_CONFIG_ARGS, 'add', '-A', '--'],
    cwd,
    60_000,
  )
  if (add.code !== 0) {
    throw new Error(add.stderr || add.error || 'git add failed')
  }
  const title = task.pr?.title ?? `UR background task ${task.id}`
  const commit = await runCancelableBackgroundCommand(
    task,
    gitExe(),
    [...SAFE_GIT_CONFIG_ARGS, 'commit', '--no-verify', '-m', title],
    cwd,
    120_000,
    { isolateGitConfig: false },
  )
  if (commit.code !== 0) {
    throw new Error(commit.stderr || commit.error || 'git commit failed')
  }
}

export async function createPullRequest(task: BackgroundTask, cwd: string): Promise<BackgroundTask['pr']> {
  if (!task.pr?.enabled) return task.pr
  if (
    !task.worktree?.enabled ||
    !task.worktree.path ||
    !task.branch ||
    resolve(cwd) !== resolve(task.worktree.path)
  ) {
    throw new Error(
      'Refusing to create a background pull request outside its isolated worktree.',
    )
  }
  const trust = await validatePrTrust(task, cwd)
  const pr = { ...task.pr }
  await commitIfNeeded(task, cwd)
  await validatePrTrust(task, cwd)
  if (pr.push && task.branch) {
    const push = await runCancelableBackgroundCommand(
      task,
      gitExe(),
      [
        ...SAFE_GIT_CONFIG_ARGS,
        'push',
        '--set-upstream',
        '--',
        trust.originUrl,
        task.branch,
      ],
      cwd,
      5 * 60_000,
      { isolateGitConfig: false },
    )
    if (push.code !== 0) {
      return {
        ...pr,
        created: false,
        error: push.stderr || push.error || 'git push failed',
        stdout: push.stdout,
        stderr: push.stderr,
      }
    }
  }

  const args = ['pr', 'create']
  if (pr.title) args.push('--title', pr.title)
  if (pr.body) args.push('--body', pr.body)
  if (pr.base) args.push('--base', pr.base)
  if (pr.draft) args.push('--draft')
  if (!pr.title && !pr.body) args.push('--fill')
  args.push('--repo', trust.repository, '--head', task.branch)

  const gh = await runCancelableBackgroundCommand(
    task,
    'gh',
    args,
    cwd,
    5 * 60_000,
  )
  return {
    ...pr,
    command: ['gh', ...args],
    created: gh.code === 0,
    stdout: gh.stdout,
    stderr: gh.stderr || gh.error,
    error: gh.code === 0 ? undefined : gh.stderr || gh.error || 'gh pr create failed',
  }
}

export async function runBackgroundWorker(cwd: string, id: string): Promise<BackgroundTask> {
  const task = getBackgroundTask(cwd, id)
  if (!task) throw new Error(`Background task not found: ${id}`)
  let claimed = false
  const claimedTask = updateTask(task.cwd, task.id, t => {
    if (t.status !== 'queued') return
    claimed = true
    t.status = 'running'
    t.workerPid = process.pid
    t.startedAt = t.startedAt ?? now()
  })
  if (!claimed || !claimedTask) return claimedTask ?? task
  writeFileSync(task.logFile, `[${now()}] worker started for ${id}\n`, {
    flag: 'a',
    mode: 0o600,
  })

  try {
    const runCwd = await setupWorktree(task)
    if (task.pr?.enabled) {
      const trust = await establishPrTrust(task, runCwd)
      task.pr = { ...task.pr, trust }
      updateTask(task.cwd, task.id, current => {
        if (current.pr?.enabled) current.pr = { ...current.pr, trust }
      })
    }
    const beforeRun = getBackgroundTask(task.cwd, task.id)
    if (!beforeRun || beforeRun.status === 'canceled') {
      return beforeRun ?? claimedTask
    }
    writeFileSync(task.logFile, `[${now()}] running in ${runCwd}\n`, {
      flag: 'a',
      mode: 0o600,
    })
    appendRunAction(task.cwd, task.id, {
      kind: 'background-worker-start',
      title: task.task,
      status: 'running',
      reason: 'start background worker in resolved run directory',
      nextAction: 'run headless agent and collect output',
      data: { runCwd },
    })
    const exitCode = await runHeadlessAgent(task, runCwd)
    const afterRun = getBackgroundTask(task.cwd, task.id)
    if (!afterRun || afterRun.status === 'canceled') {
      return afterRun ?? claimedTask
    }
    const pr =
      exitCode === 0 && task.pr?.enabled
        ? await createPullRequest(task, runCwd)
        : task.pr
    const completed = updateTask(task.cwd, task.id, t => {
      if (t.status === 'canceled') return
      t.exitCode = exitCode
      t.status = exitCode === 0 && (!pr?.enabled || pr.created !== false) ? 'completed' : 'failed'
      t.completedAt = now()
      delete t.workerPid
      delete t.agentPid
      if (pr) t.pr = pr
    })
    writeFileSync(task.logFile, `[${now()}] worker finished with exit ${exitCode}\n`, {
      flag: 'a',
      mode: 0o600,
    })
    await captureBackgroundDiff(runCwd, task.cwd, task.id)
    writeRunReport(task.cwd, task.id, formatBackgroundTask(completed ?? task))
    return completed ?? task
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const failed = updateTask(task.cwd, task.id, t => {
      if (t.status === 'canceled') return
      t.status = 'failed'
      t.error = message
      t.completedAt = now()
      delete t.workerPid
      delete t.agentPid
    })
    if (failed?.status === 'canceled') return failed
    writeFileSync(task.logFile, `[${now()}] worker failed: ${message}\n`, {
      flag: 'a',
      mode: 0o600,
    })
    appendRunAction(task.cwd, task.id, {
      kind: 'background-worker-failed',
      title: task.task,
      status: 'failed',
      stderr: message,
      reason: 'background worker threw before normal completion',
      nextAction: 'inspect background log and retry or rollback',
    })
    writeRunReport(task.cwd, task.id, formatBackgroundTask(failed ?? task))
    return failed ?? task
  }
}

async function captureBackgroundDiff(runCwd: string, rootCwd: string, runId: string): Promise<void> {
  const diff = await git(runCwd, [
    '-c',
    'core.fsmonitor=false',
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--',
  ], 30_000)
  appendCommandLog(rootCwd, runId, {
    command: 'git -c core.fsmonitor=false diff --no-ext-diff --no-textconv --',
    exitCode: diff.code,
    stdout: diff.stdout,
    stderr: diff.stderr,
    reason: 'capture background task research trace diff.patch',
    nextAction: diff.code === 0 ? 'review captured diff' : 'inspect git diff failure',
  })
  writeRunDiff(rootCwd, runId, diff.code === 0 ? diff.stdout : `${diff.stdout}\n${diff.stderr}`.trim())
}

type BackgroundProcessKiller = (
  pid: number,
  signal: NodeJS.Signals,
) => boolean

export function stopBackgroundTask(
  cwd: string,
  id: string,
  killProcess?: BackgroundProcessKiller,
): BackgroundTask | null {
  if (!isSafeTaskId(id)) return null
  // Persist cancellation only. The owning worker observes this state and
  // terminates its in-memory child handle; persisted PIDs may be stale/reused.
  void killProcess
  const task = withManifestLock(cwd, root => {
    const manifest = loadManifest(root)
    const current = manifest.tasks.find(value => value.id === id)
    if (!current) return null
    if (current.status !== 'queued' && current.status !== 'running') {
      return current
    }
    current.status = 'canceled'
    current.completedAt = now()
    current.updatedAt = now()
    delete current.workerPid
    delete current.agentPid
    saveManifest(root, manifest)
    return current
  })
  return task
}

export function formatBackgroundTask(task: BackgroundTask): string {
  const lines = [
    `${task.id} [${task.status}] ${task.task}`,
    `cwd: ${task.cwd}`,
    `run: ${task.runCwd}`,
    `log: ${task.logFile}`,
    `output: ${task.outputFile}`,
    `inbox: ${task.inboxFile}`,
  ]
  if (task.workerPid) lines.push(`worker pid: ${task.workerPid}`)
  if (task.agentPid) lines.push(`agent pid: ${task.agentPid}`)
  if (task.worktree?.path) lines.push(`worktree: ${task.worktree.path}`)
  if (task.branch) lines.push(`branch: ${task.branch}`)
  if (task.pr?.enabled) {
    lines.push(`pr: ${task.pr.created ? 'created' : task.pr.error ? `failed (${task.pr.error})` : 'pending'}`)
    if (task.pr.command) lines.push(`pr command: ${task.pr.command.map(quote).join(' ')}`)
    if (task.pr.stdout?.trim()) lines.push(`pr stdout: ${task.pr.stdout.trim()}`)
  }
  if (task.error) lines.push(`error: ${task.error}`)
  return lines.join('\n')
}

export function formatBackgroundList(tasks: BackgroundTask[], json: boolean): string {
  if (json) return JSON.stringify({ tasks }, null, 2)
  if (tasks.length === 0) return 'No background agent runs yet.'
  return [
    'Background agent runs',
    '',
    ...tasks.map(t => {
      const pr = t.pr?.enabled ? ' pr' : ''
      const wt = t.worktree?.enabled ? ' worktree' : ''
      return `- ${t.id} [${t.status}]${wt}${pr} ${t.task}`
    }),
  ].join('\n')
}
