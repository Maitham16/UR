import { spawn } from 'node:child_process'
import {
  closeSync,
  existsSync,
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
import { randomUUID } from 'node:crypto'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
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
  }
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
}

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

  return {
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
  source?: { artifactId?: string },
): BackgroundTask | null {
  const task = getBackgroundTask(cwd, id)
  if (!task) return null
  const at = now()
  const entry = {
    at,
    type: 'artifact-feedback',
    artifactId: source?.artifactId,
    text,
  }
  writeFileSync(task.inboxFile, `${JSON.stringify(entry)}\n`, {
    flag: 'a',
    mode: 0o600,
  })
  writeFileSync(
    task.logFile,
    `[${at}] steering feedback${source?.artifactId ? ` from artifact ${source.artifactId}` : ''}: ${text}\n`,
    { flag: 'a', mode: 0o600 },
  )
  return updateTask(cwd, id, t => {
    t.updatedAt = at
  })
}

export function readBackgroundInbox(cwd: string, id: string): string | null {
  const task = getBackgroundTask(cwd, id)
  if (!task || !existsSync(task.inboxFile)) return null
  return readFileSync(task.inboxFile, 'utf-8')
}

export function createBackgroundTask(
  options: StartBackgroundTaskOptions,
): BackgroundTask {
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
        t.status = 'failed'
        t.error = error.message
        t.completedAt = now()
      })
    })
    child.unref()
    updateTask(task.cwd, task.id, t => {
      t.workerPid = child.pid
    })
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
  return execFileNoThrowWithCwd(gitExe(), args, {
    cwd,
    timeout,
    preserveOutputOnError: true,
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
    const result = await git(task.cwd, ['worktree', 'add', '-b', branch, path, 'HEAD'], 120_000)
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
  artifactId?: string
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
  if (!existsSync(file)) return { nextOffset: offset, entries: [] }
  const size = statSync(file).size
  if (size <= offset) return { nextOffset: size, entries: [] }
  const text = readFileSync(file, 'utf-8').slice(offset)
  const entries: InboxEntry[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parsed = safeParseJSON(trimmed, false)
    if (parsed && typeof parsed === 'object') entries.push(parsed as InboxEntry)
  }
  return { nextOffset: size, entries }
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

  const env = task.model
    ? { ...process.env, UR_MODEL: task.model, OLLAMA_MODEL: task.model }
    : process.env

  return await new Promise(resolve => {
    const outputFd = openSync(task.outputFile, 'a', 0o600)
    const logFd = openSync(task.logFile, 'a', 0o600)
    let inboxOffset = existsSync(task.inboxFile) ? statSync(task.inboxFile).size : 0
    let sawResult = false
    let closedInput = false
    let cleanedUp = false
    let closeTimer: ReturnType<typeof setTimeout> | undefined

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
      const read = readInboxEntriesFromOffset(task.inboxFile, inboxOffset)
      inboxOffset = read.nextOffset
      for (const entry of read.entries) {
        const steering = formatInboxSteering(entry)
        if (steering) writeSteering(steering)
      }
      if (sawResult) closeInputSoon()
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
    const interval = setInterval(pumpInbox, 500)

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
      clearInterval(interval)
      if (closeTimer) clearTimeout(closeTimer)
      closeSync(outputFd)
      closeSync(logFd)
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

export async function commitIfNeeded(task: BackgroundTask, cwd: string): Promise<void> {
  const status = await git(cwd, ['status', '--porcelain'])
  if (status.code !== 0 || !status.stdout.trim()) return
  await git(cwd, ['add', '-A'])
  const title = task.pr?.title ?? `UR background task ${task.id}`
  const commit = await git(cwd, ['commit', '-m', title], 120_000)
  if (commit.code !== 0) {
    throw new Error(commit.stderr || commit.error || 'git commit failed')
  }
}

export async function createPullRequest(task: BackgroundTask, cwd: string): Promise<BackgroundTask['pr']> {
  if (!task.pr?.enabled) return task.pr
  const pr = { ...task.pr }
  await commitIfNeeded(task, cwd)
  if (pr.push && task.branch) {
    const push = await git(cwd, ['push', '--set-upstream', 'origin', task.branch], 5 * 60_000)
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

  const gh = await execFileNoThrowWithCwd('gh', args, {
    cwd,
    timeout: 5 * 60_000,
    preserveOutputOnError: true,
  })
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
  writeFileSync(task.logFile, `[${now()}] worker started for ${id}\n`, {
    flag: 'a',
    mode: 0o600,
  })
  updateTask(task.cwd, task.id, t => {
    t.status = 'running'
    t.workerPid = process.pid
    t.startedAt = t.startedAt ?? now()
  })

  try {
    const runCwd = await setupWorktree(task)
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
    const pr = task.pr?.enabled ? await createPullRequest(task, runCwd) : task.pr
    const completed = updateTask(task.cwd, task.id, t => {
      t.exitCode = exitCode
      t.status = exitCode === 0 && (!pr?.enabled || pr.created !== false) ? 'completed' : 'failed'
      t.completedAt = now()
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
      t.status = 'failed'
      t.error = message
      t.completedAt = now()
    })
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
  const diff = await execFileNoThrowWithCwd(gitExe(), ['diff', '--no-ext-diff', '--'], {
    cwd: runCwd,
    timeout: 30_000,
    preserveOutputOnError: true,
    audit: {
      cwd: rootCwd,
      runId,
      reason: 'capture background task research trace diff.patch',
    },
  })
  writeRunDiff(rootCwd, runId, diff.code === 0 ? diff.stdout : `${diff.stdout}\n${diff.stderr}`.trim())
}

export function stopBackgroundTask(cwd: string, id: string): BackgroundTask | null {
  const task = getBackgroundTask(cwd, id)
  if (!task) return null
  const pid = task.agentPid ?? task.workerPid
  if (pid) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // Process may have already exited; status update below is still useful.
    }
  }
  return updateTask(cwd, id, t => {
    t.status = 'canceled'
    t.completedAt = now()
  })
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
