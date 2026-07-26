import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  appendFileSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { lockSync } from '../../utils/lockfile.js'
import {
  PERMISSION_MODES,
  type PermissionMode,
} from '../../types/permissions.js'
import { safeParseJSON } from '../../utils/json.js'
import { isSecretLikeSubprocessEnvName } from '../../utils/subprocessEnv.js'
import { type ArenaResult, runArena } from './arena.js'
import {
  createDefaultManagedCloudClient,
  type ManagedCloudClient,
} from './cloudManagedRunner.js'
import { recordOutcome } from './learning.js'

export type CloudTaskStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'canceled'

export type CloudCandidate = {
  id: string
  status: 'queued' | 'starting' | 'running' | 'done' | 'failed' | 'canceled'
  sessionId?: string
  title?: string
  cursor?: string | null
  branch?: string
  output?: string
  verdict?: string | null
  error?: string
  eligible?: boolean
  rank?: number
  ineligibilityReason?: string
  startedAt?: string
  completedAt?: string
}

export type CloudSteeringReceipt = {
  requestId: string
  acceptedAt: string
  messageSha256: string
  deliveredTo: string[]
  state?: 'pending' | 'delivered' | 'failed'
  error?: string
}

export type CloudTask = {
  id: string
  task: string
  attempts: number
  status: CloudTaskStatus
  runner: 'local' | 'managed'
  model?: string
  maxTurns?: number
  environmentId?: string
  permissionMode?: PermissionMode
  createdAt: string
  updatedAt: string
  workerPid?: number
  candidates?: CloudCandidate[]
  steeringReceipts?: CloudSteeringReceipt[]
  error?: string
  winner?: {
    id: string
    verdict: string | null
    hasDiff: boolean
    sessionId?: string
    branch?: string
  } | null
}

type ManifestV1 = {
  version: 1
  tasks: Array<Omit<CloudTask, 'runner'> & { runner?: 'local' }>
}
type ManifestV2 = { version: 2; tasks: CloudTask[] }
type CloudManifest = ManifestV2

export type CloudSteerResult = {
  accepted: boolean
  duplicate?: boolean
  requestId: string
  deliveredTo: string[]
  reason?: string
}

const MAX_TASK_TEXT_BYTES = 64 * 1024
export const MAX_CLOUD_STEERING_MESSAGE_BYTES = 64 * 1024
const MAX_CLOUD_STEERING_RECEIPTS = 200
const MAX_CLOUD_LOG_BYTES = 8 * 1024 * 1024
const MAX_CLOUD_MANIFEST_BYTES = 8 * 1024 * 1024
const MAX_CLOUD_TASKS = 1_000
const MAX_MANAGED_POLLS = 43_200
const MAX_MANAGED_POLL_INTERVAL_MS = 60_000
const MIN_MANAGED_POLL_INTERVAL_MS = 50

function assertSafeStateNode(path: string, kind: 'file' | 'directory'): void {
  if (!existsSync(path)) return
  const info = lstatSync(path)
  if (
    info.isSymbolicLink() ||
    (kind === 'file' ? !info.isFile() : !info.isDirectory())
  ) {
    throw new Error(`Unsafe cloud state ${kind}: ${path}`)
  }
}

function ensureCloudDirectory(cwd: string): void {
  const urDir = join(cwd, '.ur')
  mkdirSync(urDir, { recursive: true, mode: 0o700 })
  assertSafeStateNode(urDir, 'directory')
  const directory = cloudDir(cwd)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  assertSafeStateNode(directory, 'directory')
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/u.test(value.trim())
        ? Number(value)
        : Number.NaN
  return Number.isSafeInteger(numeric) && numeric >= minimum
    ? Math.min(numeric, maximum)
    : fallback
}

function secretValues(): string[] {
  return Object.entries(process.env)
    .filter(
      ([name, value]) =>
        isSecretLikeSubprocessEnvName(name) && (value?.length ?? 0) >= 6,
    )
    .map(([, value]) => value as string)
    .sort((left, right) => right.length - left.length)
}

export function redactCloudText(input: string): string {
  let text = input
  for (const secret of secretValues()) {
    text = text.split(secret).join('[REDACTED]')
  }
  return text
    .replace(
      /\b(Bearer\s+)[A-Za-z0-9._~+/-]{8,}={0,2}/giu,
      '$1[REDACTED]',
    )
    .replace(
      /\b((?:password|passwd|token|secret|api[_-]?key)\s*[:=]\s*)[^\s,;]+/giu,
      '$1[REDACTED]',
    )
    .replace(
      /\b(?:gh[opusr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{12,})\b/gu,
      '[REDACTED]',
    )
}

/**
 * The worker itself keeps provider credentials for managed API calls, while
 * forcing every nested code/tool subprocess through the shared secret scrub.
 */
export function cloudWorkerEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...source,
    UR_CODE_SUBPROCESS_ENV_SCRUB: '1',
  }
}

function boundedCloudOutput(input: string, maxBytes = 1_000_000): string {
  const buffer = Buffer.from(redactCloudText(input), 'utf8')
  return buffer.subarray(Math.max(0, buffer.length - maxBytes)).toString('utf8')
}

export function cloudDir(cwd: string): string {
  return join(cwd, '.ur', 'cloud')
}

function manifestPath(cwd: string): string {
  return join(cloudDir(cwd), 'manifest.json')
}

function resultPath(cwd: string, id: string): string {
  assertSafeTaskId(id)
  return join(cloudDir(cwd), `${id}-result.json`)
}

function logPath(cwd: string, id: string): string {
  assertSafeTaskId(id)
  return join(cloudDir(cwd), `${id}.log`)
}

function manifestLockPath(cwd: string): string {
  return join(cloudDir(cwd), '.manifest.lock')
}

function now(): string {
  return new Date().toISOString()
}

function isSafeTaskId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= 128 &&
    /^[a-zA-Z0-9_-]+$/u.test(id)
  )
}

function assertSafeTaskId(id: string): void {
  if (!isSafeTaskId(id)) throw new Error(`Invalid cloud task id: ${id}`)
}

function boundedAttempts(value: number): number {
  return Number.isSafeInteger(value) ? Math.min(8, Math.max(1, value)) : 3
}

/**
 * Conservative, shell-safe subset of valid Git branch names. Managed results
 * are never selected unless their review branch passes this check.
 */
export function isSafeManagedBranch(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 255 ||
    value !== value.trim() ||
    value === '@' ||
    value.startsWith('-') ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.endsWith('.') ||
    value.includes('..') ||
    value.includes('@{') ||
    !/^[a-zA-Z0-9/._+@-]+$/u.test(value)
  ) {
    return false
  }
  return !value
    .split('/')
    .some(
      component =>
        component === '' ||
        component === '.' ||
        component === '..' ||
        component.startsWith('.') ||
        component.toLowerCase().endsWith('.lock'),
    )
}

function normalizeCandidate(value: unknown): CloudCandidate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Partial<CloudCandidate>
  if (
    !isSafeTaskId(candidate.id) ||
    !['queued', 'starting', 'running', 'done', 'failed', 'canceled'].includes(
      candidate.status ?? '',
    )
  ) {
    return null
  }
  return {
    id: candidate.id,
    status: candidate.status!,
    ...(typeof candidate.sessionId === 'string'
      ? { sessionId: candidate.sessionId.slice(0, 256) }
      : {}),
    ...(typeof candidate.title === 'string'
      ? { title: candidate.title.slice(0, 1_000) }
      : {}),
    ...(typeof candidate.cursor === 'string' || candidate.cursor === null
      ? { cursor: candidate.cursor }
      : {}),
    ...(typeof candidate.branch === 'string'
      ? { branch: candidate.branch.slice(0, 1_000) }
      : {}),
    ...(typeof candidate.output === 'string'
      ? { output: boundedCloudOutput(candidate.output) }
      : {}),
    ...(typeof candidate.verdict === 'string' || candidate.verdict === null
      ? { verdict: candidate.verdict }
      : {}),
    ...(typeof candidate.error === 'string'
      ? { error: redactCloudText(candidate.error).slice(0, 20_000) }
      : {}),
    ...(typeof candidate.eligible === 'boolean'
      ? { eligible: candidate.eligible }
      : {}),
    ...(Number.isSafeInteger(candidate.rank) && Number(candidate.rank) > 0
      ? { rank: Number(candidate.rank) }
      : {}),
    ...(typeof candidate.ineligibilityReason === 'string'
      ? {
          ineligibilityReason: redactCloudText(
            candidate.ineligibilityReason,
          ).slice(0, 1_000),
        }
      : {}),
    ...(typeof candidate.startedAt === 'string'
      ? { startedAt: candidate.startedAt }
      : {}),
    ...(typeof candidate.completedAt === 'string'
      ? { completedAt: candidate.completedAt }
      : {}),
  }
}

function normalizeTask(value: unknown): CloudTask | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const task = value as Partial<CloudTask>
  if (
    !isSafeTaskId(task.id) ||
    typeof task.task !== 'string' ||
    Buffer.byteLength(task.task, 'utf8') > MAX_TASK_TEXT_BYTES ||
    !['queued', 'running', 'done', 'failed', 'canceled'].includes(
      task.status ?? '',
    )
  ) {
    return null
  }
  const runner = task.runner === 'managed' ? 'managed' : 'local'
  const managedWinnerEligible =
    runner !== 'managed' ||
    (task.winner &&
      typeof task.winner === 'object' &&
      task.winner.verdict === 'PASS' &&
      isSafeManagedBranch(task.winner.branch))
  const normalizedStatus =
    runner === 'managed' &&
    task.status === 'done' &&
    !managedWinnerEligible
      ? 'failed'
      : task.status!
  const candidates = Array.isArray(task.candidates)
    ? task.candidates
        .map(normalizeCandidate)
        .filter((candidate): candidate is CloudCandidate => candidate !== null)
        .slice(0, 8)
    : undefined
  return {
    id: task.id,
    task: task.task,
    attempts: boundedAttempts(Number(task.attempts)),
    status: normalizedStatus,
    runner,
    ...(typeof task.model === 'string' ? { model: task.model.slice(0, 256) } : {}),
    ...(Number.isSafeInteger(task.maxTurns) && Number(task.maxTurns) > 0
      ? { maxTurns: Number(task.maxTurns) }
      : {}),
    ...(typeof task.environmentId === 'string'
      ? { environmentId: task.environmentId.slice(0, 256) }
      : {}),
    ...(typeof task.permissionMode === 'string' &&
    (PERMISSION_MODES as readonly string[]).includes(task.permissionMode)
      ? { permissionMode: task.permissionMode as PermissionMode }
      : {}),
    createdAt: typeof task.createdAt === 'string' ? task.createdAt : now(),
    updatedAt: typeof task.updatedAt === 'string' ? task.updatedAt : now(),
    ...(Number.isSafeInteger(task.workerPid)
      ? { workerPid: Number(task.workerPid) }
      : {}),
    ...(candidates ? { candidates } : {}),
    ...(Array.isArray(task.steeringReceipts)
      ? {
          steeringReceipts: task.steeringReceipts
            .filter(
              (receipt): receipt is CloudSteeringReceipt =>
                !!receipt &&
                typeof receipt.requestId === 'string' &&
                typeof receipt.acceptedAt === 'string' &&
                typeof receipt.messageSha256 === 'string' &&
                Array.isArray(receipt.deliveredTo) &&
                isSafeTaskId(receipt.requestId),
            )
            .map(receipt => ({
              requestId: receipt.requestId,
              acceptedAt: receipt.acceptedAt,
              messageSha256: receipt.messageSha256.slice(0, 128),
              deliveredTo: receipt.deliveredTo
                .filter(isSafeTaskId)
                .slice(0, 8),
              state:
                receipt.state === 'pending' ||
                receipt.state === 'failed' ||
                receipt.state === 'delivered'
                  ? receipt.state
                  : 'delivered',
              ...(typeof receipt.error === 'string'
                ? { error: redactCloudText(receipt.error).slice(0, 20_000) }
                : {}),
            }))
            .slice(-MAX_CLOUD_STEERING_RECEIPTS),
        }
      : {}),
    ...(typeof task.error === 'string'
      ? { error: redactCloudText(task.error).slice(0, 20_000) }
      : runner === 'managed' &&
          task.status === 'done' &&
          !managedWinnerEligible
        ? {
            error:
              'Persisted managed selection is missing a safe PASS review branch',
          }
      : {}),
    ...(task.winner &&
    typeof task.winner === 'object' &&
    managedWinnerEligible
      ? {
          winner: {
            id: String(task.winner.id),
            verdict:
              typeof task.winner.verdict === 'string'
                ? task.winner.verdict
                : null,
            hasDiff: task.winner.hasDiff === true,
            ...(typeof task.winner.sessionId === 'string'
              ? { sessionId: task.winner.sessionId }
              : {}),
            ...(typeof task.winner.branch === 'string'
              ? { branch: task.winner.branch }
              : {}),
          },
        }
      : task.winner === null ||
          (runner === 'managed' && !managedWinnerEligible)
        ? { winner: null }
        : {}),
  }
}

export function loadCloudManifest(cwd: string): CloudManifest {
  const path = manifestPath(cwd)
  if (!existsSync(path)) return { version: 2, tasks: [] }
  assertSafeStateNode(join(cwd, '.ur'), 'directory')
  assertSafeStateNode(cloudDir(cwd), 'directory')
  assertSafeStateNode(path, 'file')
  const manifestInfo = lstatSync(path)
  if (manifestInfo.size > MAX_CLOUD_MANIFEST_BYTES) {
    throw new Error('Cloud manifest exceeds the 8 MiB limit')
  }
  const parsed = safeParseJSON(readFileSync(path, 'utf8'), false) as
    | ManifestV1
    | ManifestV2
    | null
  if (
    !parsed ||
    (parsed.version !== 1 && parsed.version !== 2) ||
    !Array.isArray(parsed.tasks)
  ) {
    throw new Error('Cloud manifest is invalid')
  }
  if (parsed.tasks.length > MAX_CLOUD_TASKS) {
    throw new Error(`Cloud manifest exceeds ${MAX_CLOUD_TASKS} tasks`)
  }
  return {
    version: 2,
    tasks: parsed.tasks
      .map(normalizeTask)
      .filter((task): task is CloudTask => task !== null),
  }
}

function saveManifest(cwd: string, manifest: CloudManifest): void {
  ensureCloudDirectory(cwd)
  if (manifest.tasks.length > MAX_CLOUD_TASKS) {
    throw new Error(`Cloud manifest exceeds ${MAX_CLOUD_TASKS} tasks`)
  }
  const destination = manifestPath(cwd)
  assertSafeStateNode(destination, 'file')
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`
  if (Buffer.byteLength(serialized, 'utf8') > MAX_CLOUD_MANIFEST_BYTES) {
    throw new Error('Cloud manifest exceeds the 8 MiB limit')
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

function withManifestMutation<T>(
  cwd: string,
  operation: (manifest: CloudManifest) => T,
): T {
  ensureCloudDirectory(cwd)
  const lockPath = manifestLockPath(cwd)
  assertSafeStateNode(lockPath, 'file')
  writeFileSync(lockPath, '', { flag: 'a', mode: 0o600 })
  const release = lockSync(lockPath, { realpath: false, stale: 30_000 })
  try {
    const manifest = loadCloudManifest(cwd)
    const value = operation(manifest)
    saveManifest(cwd, manifest)
    return value
  } finally {
    release()
  }
}

function updateTask(
  cwd: string,
  id: string,
  patch:
    | Partial<CloudTask>
    | ((task: CloudTask) => void),
): CloudTask | null {
  assertSafeTaskId(id)
  return withManifestMutation(cwd, manifest => {
    const task = manifest.tasks.find(candidate => candidate.id === id)
    if (!task) return null
    if (typeof patch === 'function') patch(task)
    else Object.assign(task, patch)
    task.updatedAt = now()
    return structuredClone(task)
  })
}

export function listCloudTasks(cwd: string): CloudTask[] {
  return loadCloudManifest(cwd).tasks.sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )
}

export function getCloudTask(cwd: string, id: string): CloudTask | null {
  if (!isSafeTaskId(id)) return null
  return loadCloudManifest(cwd).tasks.find(task => task.id === id) ?? null
}

export function loadCloudResult(cwd: string, id: string): ArenaResult | null {
  if (!isSafeTaskId(id)) return null
  const path = resultPath(cwd, id)
  if (!existsSync(path)) return null
  assertSafeStateNode(join(cwd, '.ur'), 'directory')
  assertSafeStateNode(cloudDir(cwd), 'directory')
  assertSafeStateNode(path, 'file')
  if (lstatSync(path).size > MAX_CLOUD_MANIFEST_BYTES) {
    throw new Error('Cloud result exceeds the 8 MiB limit')
  }
  return safeParseJSON(readFileSync(path, 'utf-8'), false) as ArenaResult | null
}

export function createCloudTask(
  cwd: string,
  input: {
    task: string
    attempts: number
    model?: string
    maxTurns?: number
    runner?: 'local' | 'managed'
    environmentId?: string
    permissionMode?: PermissionMode
  },
): CloudTask {
  const taskText = input.task.trim()
  if (!taskText || Buffer.byteLength(taskText, 'utf8') > MAX_TASK_TEXT_BYTES) {
    throw new Error('Cloud task text must be between 1 byte and 64 KiB')
  }
  if (
    input.permissionMode &&
    !(PERMISSION_MODES as readonly string[]).includes(input.permissionMode)
  ) {
    throw new Error(`Invalid cloud permission mode: ${input.permissionMode}`)
  }
  const createdAt = now()
  const attempts = boundedAttempts(input.attempts)
  const runner = input.runner ?? 'local'
  const task: CloudTask = {
    id: `cl-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
    task: taskText,
    attempts,
    status: 'queued',
    runner,
    model: input.model,
    maxTurns: input.maxTurns,
    environmentId: input.environmentId,
    permissionMode: input.permissionMode,
    createdAt,
    updatedAt: createdAt,
    ...(runner === 'managed'
      ? {
          candidates: Array.from({ length: attempts }, (_, index) => ({
            id: `c${index + 1}`,
            status: 'queued' as const,
          })),
        }
      : {}),
  }
  return withManifestMutation(cwd, manifest => {
    if (manifest.tasks.length >= MAX_CLOUD_TASKS) {
      throw new Error(`Cloud task limit reached (${MAX_CLOUD_TASKS})`)
    }
    manifest.tasks.push(task)
    return structuredClone(task)
  })
}

export function claimCloudTaskForWorkerSpawn(
  cwd: string,
  id: string,
): boolean {
  assertSafeTaskId(id)
  return withManifestMutation(cwd, manifest => {
    const task = manifest.tasks.find(candidate => candidate.id === id)
    if (!task || task.status !== 'queued') return false
    task.status = 'running'
    task.updatedAt = now()
    return true
  })
}

export function recordCloudWorkerPid(
  cwd: string,
  id: string,
  pid: number,
): boolean {
  assertSafeTaskId(id)
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  return withManifestMutation(cwd, manifest => {
    const task = manifest.tasks.find(candidate => candidate.id === id)
    if (!task || task.status !== 'running') return false
    task.workerPid = pid
    task.updatedAt = now()
    return true
  })
}

function failRunningCloudTask(cwd: string, id: string, error: string): boolean {
  let transitioned = false
  updateTask(cwd, id, current => {
    if (current.status !== 'running') return
    current.status = 'failed'
    current.error = error
    delete current.workerPid
    transitioned = true
  })
  return transitioned
}

function prepareCloudWorkerExecution(cwd: string, id: string): boolean {
  assertSafeTaskId(id)
  return withManifestMutation(cwd, manifest => {
    const task = manifest.tasks.find(candidate => candidate.id === id)
    if (!task || ['done', 'failed', 'canceled'].includes(task.status)) {
      return false
    }
    if (task.status === 'queued') task.status = 'running'
    task.updatedAt = now()
    return true
  })
}

export function spawnCloudWorker(
  cwd: string,
  id: string,
  bin?: { file: string; baseArgs: string[] },
): number | null {
  assertSafeTaskId(id)
  if (!claimCloudTaskForWorkerSpawn(cwd, id)) return null
  const file = bin?.file ?? process.execPath
  const baseArgs = bin?.baseArgs ?? [process.argv[1] ?? '']
  ensureCloudDirectory(cwd)
  const destination = logPath(cwd, id)
  assertSafeStateNode(destination, 'file')
  let log: number
  try {
    log = openSync(destination, 'a', 0o600)
  } catch (error) {
    failRunningCloudTask(
      cwd,
      id,
      redactCloudText(
        error instanceof Error ? error.message : String(error),
      ),
    )
    return null
  }
  let child
  try {
    child = spawn(file, [...baseArgs, 'cloud', 'worker', id], {
      cwd,
      detached: true,
      stdio: ['ignore', log, log],
      env: cloudWorkerEnvironment(),
    })
  } catch (error) {
    const message = redactCloudText(
      error instanceof Error ? error.message : String(error),
    )
    failRunningCloudTask(cwd, id, message)
    closeSync(log)
    return null
  }
  closeSync(log)
  child.once('error', error => {
    const message = redactCloudText(error.message)
    failRunningCloudTask(cwd, id, message)
    appendCloudLog(cwd, id, `[${now()}] worker spawn failed: ${message}`)
  })
  child.unref()
  if (!child.pid) {
    failRunningCloudTask(
      cwd,
      id,
      'Cloud worker did not receive a process id',
    )
    return null
  }
  if (!recordCloudWorkerPid(cwd, id, child.pid)) {
    child.kill('SIGTERM')
    return null
  }
  return child.pid ?? null
}

function appendCloudLog(cwd: string, id: string, text: string): void {
  const path = logPath(cwd, id)
  ensureCloudDirectory(cwd)
  assertSafeStateNode(path, 'file')
  if (existsSync(path) && statSync(path).size >= MAX_CLOUD_LOG_BYTES) return
  const remaining = existsSync(path)
    ? MAX_CLOUD_LOG_BYTES - statSync(path).size
    : MAX_CLOUD_LOG_BYTES
  const safe = redactCloudText(text)
  const data = Buffer.from(safe.endsWith('\n') ? safe : `${safe}\n`, 'utf8')
  appendFileSync(path, data.subarray(0, Math.max(0, remaining)), { mode: 0o600 })
}

export function readCloudLog(
  cwd: string,
  id: string,
  maxBytes = 1_000_000,
): string | null {
  if (!isSafeTaskId(id)) return null
  const path = logPath(cwd, id)
  if (!existsSync(path)) return null
  assertSafeStateNode(join(cwd, '.ur'), 'directory')
  assertSafeStateNode(cloudDir(cwd), 'directory')
  assertSafeStateNode(path, 'file')
  const buffer = readFileSync(path)
  const boundedMax = boundedInteger(maxBytes, 1_000_000, 1, MAX_CLOUD_LOG_BYTES)
  return buffer
    .subarray(Math.max(0, buffer.length - boundedMax))
    .toString('utf8')
}

function managedPrompt(task: CloudTask, candidate: CloudCandidate): string {
  return [
    task.task,
    '',
    `You are managed cloud candidate ${candidate.id} for task ${task.id}.`,
    'Work only in the isolated repository provided to you.',
    'Run relevant checks and leave the outcome branch reviewable.',
    'End your final response with exactly VERDICT: PASS, VERDICT: PARTIAL, or VERDICT: FAIL.',
  ].join('\n')
}

export async function startManagedCloudTask(
  cwd: string,
  id: string,
  client: ManagedCloudClient = createDefaultManagedCloudClient(),
): Promise<CloudTask> {
  const task = getCloudTask(cwd, id)
  if (!task) throw new Error(`cloud task not found: ${id}`)
  if (task.runner !== 'managed') {
    throw new Error(`cloud task ${id} is not a managed task`)
  }
  if (['canceled', 'done', 'failed'].includes(task.status)) return task

  const candidates: CloudCandidate[] =
    task.candidates ??
    Array.from({ length: task.attempts }, (_, index) => ({
      id: `c${index + 1}`,
      status: 'queued' as const,
    }))
  updateTask(cwd, id, current => {
    if (['canceled', 'done', 'failed'].includes(current.status)) return
    current.status = 'running'
    current.candidates = candidates
    current.error = undefined
  })
  const activated = getCloudTask(cwd, id)
  if (
    !activated ||
    ['canceled', 'done', 'failed'].includes(activated.status)
  ) {
    return activated ?? task
  }

  const startedSessionIds: string[] = []
  try {
    for (const candidate of candidates) {
      if (candidate.sessionId) continue
      const latest = getCloudTask(cwd, id)
      if (
        !latest ||
        ['done', 'failed', 'canceled'].includes(latest.status)
      ) {
        return latest ?? task
      }
      const startedAt = now()
      updateTask(cwd, id, current => {
        if (current.status !== 'running') return
        const persisted = current.candidates?.find(item => item.id === candidate.id)
        if (persisted) {
          persisted.status = 'starting'
          persisted.startedAt = startedAt
        }
      })
      const controller = new AbortController()
      const created = await client.start({
        taskId: id,
        candidateId: candidate.id,
        prompt: managedPrompt(task, candidate),
        model: task.model,
        environmentId: task.environmentId,
        permissionMode: task.permissionMode,
        signal: controller.signal,
      })
      startedSessionIds.push(created.sessionId)
      const afterStart = getCloudTask(cwd, id)
      if (
        !afterStart ||
        ['canceled', 'done', 'failed'].includes(afterStart.status)
      ) {
        await client.cancel(created.sessionId).catch(() => undefined)
        appendCloudLog(
          cwd,
          id,
          `[${now()}] ${candidate.id} session canceled after task became terminal`,
        )
        return afterStart ?? task
      }
      updateTask(cwd, id, current => {
        if (current.status !== 'running') return
        const persisted = current.candidates?.find(item => item.id === candidate.id)
        if (persisted) {
          persisted.sessionId = created.sessionId
          persisted.title = created.title
          persisted.status = 'running'
        }
      })
      appendCloudLog(
        cwd,
        id,
        `[${now()}] ${candidate.id} started managed session ${created.sessionId}`,
      )
    }
  } catch (error) {
    await Promise.allSettled(
      startedSessionIds.map(sessionId => client.cancel(sessionId)),
    )
    const message = redactCloudText(
      error instanceof Error ? error.message : String(error),
    )
    const failed =
      updateTask(cwd, id, current => {
        if (['canceled', 'done', 'failed'].includes(current.status)) return
        current.status = 'failed'
        current.error = message
        delete current.workerPid
        for (const candidate of current.candidates ?? []) {
          if (candidate.sessionId) {
            candidate.status = 'canceled'
            candidate.completedAt = now()
          } else if (candidate.status === 'starting') {
            candidate.status = 'failed'
            candidate.error = message
            candidate.completedAt = now()
          }
        }
      }) ?? task
    if (failed.status === 'failed') {
      appendCloudLog(cwd, id, `[${now()}] managed start failed: ${message}`)
    }
    return failed
  }
  return getCloudTask(cwd, id) ?? task
}

function settleManagedTask(cwd: string, id: string): CloudTask | null {
  return updateTask(cwd, id, task => {
    if (['done', 'failed', 'canceled'].includes(task.status)) return
    const candidates = task.candidates ?? []
    if (
      candidates.length === 0 ||
      candidates.some(candidate =>
        ['queued', 'starting', 'running'].includes(candidate.status),
      )
    ) {
      task.status = 'running'
      return
    }
    for (const candidate of candidates) {
      delete candidate.rank
      if (candidate.status !== 'done') {
        candidate.eligible = false
        candidate.ineligibilityReason = `candidate status is ${candidate.status}`
      } else if (candidate.verdict !== 'PASS') {
        candidate.eligible = false
        candidate.ineligibilityReason = `verdict is ${candidate.verdict ?? 'missing'}`
      } else if (!candidate.branch) {
        candidate.eligible = false
        candidate.ineligibilityReason = 'missing review branch'
      } else if (!isSafeManagedBranch(candidate.branch)) {
        candidate.eligible = false
        candidate.ineligibilityReason = 'unsafe review branch'
      } else {
        candidate.eligible = true
        candidate.ineligibilityReason = undefined
      }
    }
    const eligible = candidates
      .filter(
        (
          candidate,
        ): candidate is CloudCandidate & { branch: string } =>
          candidate.eligible === true &&
          isSafeManagedBranch(candidate.branch),
      )
      .sort((left, right) => {
        if (left.id !== right.id) return left.id < right.id ? -1 : 1
        if (left.branch !== right.branch) {
          return left.branch < right.branch ? -1 : 1
        }
        const leftSession = left.sessionId ?? ''
        const rightSession = right.sessionId ?? ''
        return leftSession === rightSession
          ? 0
          : leftSession < rightSession
            ? -1
            : 1
      })
    eligible.forEach((candidate, index) => {
      candidate.rank = index + 1
    })
    const selected = eligible[0]
    if (selected) {
      task.status = 'done'
      delete task.workerPid
      task.error = undefined
      task.winner = {
        id: selected.id,
        verdict: 'PASS',
        hasDiff: false,
        sessionId: selected.sessionId,
        branch: selected.branch,
      }
    } else {
      task.status = 'failed'
      delete task.workerPid
      task.winner = null
      task.error =
        'No managed candidate produced a PASS with a safe review branch'
    }
  })
}

export async function reconcileManagedCloudTask(
  cwd: string,
  id: string,
  client: ManagedCloudClient = createDefaultManagedCloudClient(),
): Promise<CloudTask | null> {
  const task = getCloudTask(cwd, id)
  if (!task || task.runner !== 'managed') return task
  if (['done', 'failed', 'canceled'].includes(task.status)) return task

  for (const candidate of task.candidates ?? []) {
    if (candidate.status !== 'running' || !candidate.sessionId) continue
    try {
      const inspection = await client.inspect(
        candidate.sessionId,
        candidate.cursor,
      )
      const safeOutput = inspection.output
        ? boundedCloudOutput(inspection.output)
        : undefined
      const safeError = inspection.error
        ? redactCloudText(inspection.error).slice(0, 20_000)
        : undefined
      if (safeOutput?.trim()) {
        appendCloudLog(
          cwd,
          id,
          `[${now()}] ${candidate.id}\n${safeOutput}`,
        )
      }
      updateTask(cwd, id, current => {
        if (current.status !== 'running') return
        const persisted = current.candidates?.find(item => item.id === candidate.id)
        if (!persisted) return
        persisted.cursor = inspection.cursor
        persisted.branch = inspection.branch ?? persisted.branch
        persisted.output = safeOutput
          ? boundedCloudOutput(`${persisted.output ?? ''}\n${safeOutput}`.trim())
          : persisted.output
        persisted.verdict = inspection.verdict ?? persisted.verdict
        persisted.error = safeError
        if (inspection.status !== 'running') {
          persisted.status =
            inspection.status === 'completed'
              ? 'done'
              : inspection.status === 'canceled'
                ? 'canceled'
                : 'failed'
          persisted.completedAt = now()
        }
      })
    } catch (error) {
      const message = redactCloudText(
        error instanceof Error ? error.message : String(error),
      )
      appendCloudLog(
        cwd,
        id,
        `[${now()}] ${candidate.id} reconcile warning: ${message}`,
      )
      updateTask(cwd, id, current => {
        if (current.status !== 'running') return
        const persisted = current.candidates?.find(item => item.id === candidate.id)
        if (persisted) persisted.error = message
      })
    }
  }
  return settleManagedTask(cwd, id)
}

export async function steerCloudTask(
  cwd: string,
  id: string,
  message: string,
  options: {
    requestId?: string
    client?: ManagedCloudClient
  } = {},
): Promise<CloudSteerResult> {
  const requestId = options.requestId ?? randomUUID()
  if (!isSafeTaskId(requestId)) {
    return {
      accepted: false,
      requestId,
      deliveredTo: [],
      reason:
        'request id must contain only letters, digits, underscores, or dashes (max 128 characters)',
    }
  }
  const trimmed = message.trim()
  if (
    !trimmed ||
    Buffer.byteLength(trimmed, 'utf8') > MAX_CLOUD_STEERING_MESSAGE_BYTES
  ) {
    return {
      accepted: false,
      requestId,
      deliveredTo: [],
      reason: 'message must be between 1 byte and 64 KiB',
    }
  }
  const messageSha256 = createHash('sha256').update(trimmed).digest('hex')
  type Reservation =
    | {
        state: 'reserved'
        active: Array<{ id: string; sessionId: string }>
      }
    | {
        state: 'duplicate'
        receipt: CloudSteeringReceipt
        mismatch: boolean
      }
    | {
        state: 'rejected'
        reason: string
      }
  const reservation = withManifestMutation<Reservation>(cwd, manifest => {
    const task = manifest.tasks.find(candidate => candidate.id === id)
    if (!task) return { state: 'rejected', reason: 'task not found' }
    const previous = task.steeringReceipts?.find(
      receipt => receipt.requestId === requestId,
    )
    if (previous) {
      return {
        state: 'duplicate',
        receipt: structuredClone(previous),
        mismatch: previous.messageSha256 !== messageSha256,
      }
    }
    if (task.status !== 'running') {
      return { state: 'rejected', reason: `task is ${task.status}` }
    }
    if (task.runner !== 'managed') {
      return {
        state: 'rejected',
        reason:
          'live steering is supported for managed cloud tasks; use ur bg for steerable local runs',
      }
    }
    const active = (task.candidates ?? [])
      .filter(
        (
          candidate,
        ): candidate is CloudCandidate & { sessionId: string } =>
          candidate.status === 'running' &&
          typeof candidate.sessionId === 'string',
      )
      .map(candidate => ({
        id: candidate.id,
        sessionId: candidate.sessionId,
      }))
    if (active.length === 0) {
      return {
        state: 'rejected',
        reason: 'no active managed candidate accepted the message',
      }
    }
    task.steeringReceipts ??= []
    task.steeringReceipts.push({
      requestId,
      acceptedAt: now(),
      messageSha256,
      deliveredTo: [],
      state: 'pending',
    })
    task.steeringReceipts = task.steeringReceipts.slice(
      -MAX_CLOUD_STEERING_RECEIPTS,
    )
    task.updatedAt = now()
    return { state: 'reserved', active }
  })

  if (reservation.state === 'rejected') {
    return {
      accepted: false,
      requestId,
      deliveredTo: [],
      reason: reservation.reason,
    }
  }
  if (reservation.state === 'duplicate') {
    const receiptState = reservation.receipt.state ?? 'delivered'
    return {
      accepted:
        !reservation.mismatch && receiptState === 'delivered',
      duplicate: true,
      requestId,
      deliveredTo: reservation.receipt.deliveredTo,
      ...(!reservation.mismatch && receiptState === 'delivered'
        ? {}
        : {
            reason: reservation.mismatch
              ? 'request id was already used for a different message'
              : receiptState === 'pending'
                ? 'request delivery is already in progress'
                : reservation.receipt.error ??
                  'the previous delivery attempt failed',
          }),
    }
  }

  const client = options.client ?? createDefaultManagedCloudClient()
  const deliveredTo: string[] = []
  const errors: string[] = []
  for (const candidate of reservation.active) {
    try {
      if (await client.steer(candidate.sessionId, trimmed, requestId)) {
        deliveredTo.push(candidate.id)
      }
    } catch (error) {
      errors.push(
        `${candidate.id}: ${redactCloudText(
          error instanceof Error ? error.message : String(error),
        )}`,
      )
    }
  }
  const deliveryError =
    deliveredTo.length === 0
      ? errors.join('; ') ||
        'no active managed candidate accepted the message'
      : undefined
  updateTask(cwd, id, current => {
    const receipt = current.steeringReceipts?.find(
      candidate => candidate.requestId === requestId,
    )
    if (!receipt || receipt.state !== 'pending') return
    receipt.deliveredTo = deliveredTo
    receipt.state = deliveredTo.length > 0 ? 'delivered' : 'failed'
    receipt.error = deliveryError
  })
  if (deliveredTo.length === 0) {
    appendCloudLog(
      cwd,
      id,
      `[${now()}] steering ${requestId} failed: ${deliveryError}`,
    )
    return {
      accepted: false,
      requestId,
      deliveredTo: [],
      reason: deliveryError,
    }
  }
  appendCloudLog(
    cwd,
    id,
    `[${now()}] steering ${requestId} delivered to ${deliveredTo.join(', ')}`,
  )
  return { accepted: true, requestId, deliveredTo }
}

export async function cancelCloudTask(
  cwd: string,
  id: string,
  client: ManagedCloudClient = createDefaultManagedCloudClient(),
): Promise<CloudTask | null> {
  type CancellationReservation = {
    task: CloudTask | null
    transitioned: boolean
    sessionIds: string[]
  }
  const reservation = withManifestMutation<CancellationReservation>(
    cwd,
    manifest => {
      const task = manifest.tasks.find(candidate => candidate.id === id)
      if (!task) {
        return { task: null, transitioned: false, sessionIds: [] }
      }
      if (['done', 'failed', 'canceled'].includes(task.status)) {
        return {
          task: structuredClone(task),
          transitioned: false,
          sessionIds: [],
        }
      }
      const sessionIds =
        task.runner === 'managed'
          ? (task.candidates ?? [])
              .filter(
                candidate =>
                  candidate.sessionId &&
                  ['starting', 'running'].includes(candidate.status),
              )
              .map(candidate => candidate.sessionId!)
          : []
      task.status = 'canceled'
      delete task.workerPid
      task.updatedAt = now()
      for (const candidate of task.candidates ?? []) {
        if (['queued', 'starting', 'running'].includes(candidate.status)) {
          candidate.status = 'canceled'
          candidate.completedAt = now()
        }
      }
      return {
        task: structuredClone(task),
        transitioned: true,
        sessionIds,
      }
    },
  )
  if (!reservation.task || !reservation.transitioned) {
    return reservation.task
  }
  if (reservation.sessionIds.length > 0) {
    await Promise.allSettled(
      reservation.sessionIds.map(sessionId => client.cancel(sessionId)),
    )
  }
  appendCloudLog(cwd, id, `[${now()}] task canceled`)
  return reservation.task
}

export async function syncManagedCloudTasks(
  cwd: string,
  client: ManagedCloudClient = createDefaultManagedCloudClient(),
): Promise<CloudTask[]> {
  for (const task of listCloudTasks(cwd)) {
    if (task.runner === 'managed' && task.status === 'running') {
      await reconcileManagedCloudTask(cwd, task.id, client)
    }
  }
  return listCloudTasks(cwd)
}

export async function runCloudWorker(
  cwd: string,
  id: string,
  options: {
    managedClient?: ManagedCloudClient
    pollIntervalMs?: number
    maxPolls?: number
  } = {},
): Promise<void> {
  if (!getCloudTask(cwd, id)) throw new Error(`cloud task not found: ${id}`)
  if (!prepareCloudWorkerExecution(cwd, id)) return
  const task = getCloudTask(cwd, id)
  if (!task || task.status === 'canceled') return

  if (task.runner === 'managed') {
    const client = options.managedClient ?? createDefaultManagedCloudClient()
    const started = await startManagedCloudTask(cwd, id, client)
    if (started.status === 'failed' || started.status === 'canceled') return
    const pollIntervalMs = boundedInteger(
      options.pollIntervalMs ??
        process.env.UR_CLOUD_MANAGED_POLL_INTERVAL_MS,
      2_000,
      MIN_MANAGED_POLL_INTERVAL_MS,
      MAX_MANAGED_POLL_INTERVAL_MS,
    )
    const maxPolls = boundedInteger(
      options.maxPolls ?? process.env.UR_CLOUD_MANAGED_MAX_POLLS,
      MAX_MANAGED_POLLS,
      1,
      MAX_MANAGED_POLLS,
    )
    for (let poll = 0; poll < maxPolls; poll++) {
      const reconciled = await reconcileManagedCloudTask(cwd, id, client)
      if (!reconciled || ['done', 'failed', 'canceled'].includes(reconciled.status)) {
        return
      }
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
    }
    updateTask(cwd, id, current => {
      if (current.status !== 'running') return
      current.error =
        'Managed sessions remain active; run `ur cloud sync` to resume reconciliation.'
    })
    return
  }

  try {
    const result = await runArena(task.task, {
      cwd,
      agents: task.attempts,
      maxTurns: task.maxTurns,
      models: task.model
        ? Array.from({ length: task.attempts }, () => task.model!)
        : undefined,
    })
    ensureCloudDirectory(cwd)
    const resultDestination = resultPath(cwd, id)
    assertSafeStateNode(resultDestination, 'file')
    writeFileSync(resultDestination, `${JSON.stringify(result, null, 2)}\n`, {
      mode: 0o600,
    })
    let completed = false
    updateTask(cwd, id, current => {
      if (current.status !== 'running') return
      current.status = 'done'
      delete current.workerPid
      current.winner = result.winner
        ? {
            id: result.winner.id,
            verdict: result.winner.verdict,
            hasDiff: !!result.winner.diff?.trim(),
          }
        : null
      completed = true
    })
    if (!completed) {
      unlinkSync(resultDestination)
      return
    }
    recordOutcome(cwd, {
      id: `cloud-${id}`,
      task: task.task,
      model: task.model ?? null,
      pass: !!result.winner && result.winner.verdict === 'PASS',
      detail: `cloud best-of-${task.attempts}`,
    })
  } catch (error) {
    const message = redactCloudText(
      error instanceof Error ? error.message : String(error),
    )
    if (failRunningCloudTask(cwd, id, message)) {
      ensureCloudDirectory(cwd)
      const resultDestination = resultPath(cwd, id)
      assertSafeStateNode(resultDestination, 'file')
      writeFileSync(
        resultDestination,
        `${JSON.stringify({ error: message }, null, 2)}\n`,
        { mode: 0o600 },
      )
    }
    throw error
  }
}

export function formatCloudTasks(tasks: CloudTask[], json: boolean): string {
  if (json) return JSON.stringify({ tasks }, null, 2)
  if (!tasks.length) {
    return 'No cloud tasks. Start one: ur cloud run "<task>" --attempts 3'
  }
  return tasks
    .map(
      task =>
        `${task.id}  ${task.status.padEnd(8)} ${task.runner.padEnd(7)} ${
          task.runner === 'managed'
            ? `candidates=${task.attempts}`
            : `best-of-${task.attempts}`
        }  ${
          task.winner
            ? `${task.runner === 'managed' ? 'selected' : 'winner'}=${task.winner.id}(${task.winner.verdict ?? '?'})`
            : ''
        }  ${task.task.slice(0, 60)}`,
    )
    .join('\n')
}
