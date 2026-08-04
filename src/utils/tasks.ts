import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rmdir,
  unlink,
  writeFile,
} from 'fs/promises'
import type { Dirent } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'path'
import { z } from 'zod/v4'
import { getIsNonInteractiveSession, getSessionId } from '../bootstrap/state.js'
import { uniq } from './array.js'
import { logForDebugging } from './debug.js'
import { getURConfigHomeDir, getTeamsDir, isEnvTruthy } from './envUtils.js'
import { errorMessage, getErrnoCode } from './errors.js'
import { lazySchema } from './lazySchema.js'
import * as lockfile from './lockfile.js'
import { logError } from './log.js'
import { createSignal } from './signal.js'
import { jsonParse, jsonStringify } from './slowOperations.js'
import { getTeamName } from './teammate.js'
import { getTeammateContext } from './teammateContext.js'

// Listeners for task list updates (used for immediate UI refresh in same process)
const tasksUpdated = createSignal()

/**
 * Team name set by the leader when creating a team.
 * Used by getTaskListId() so the leader's tasks are stored under the team name
 * (matching where tmux/iTerm2 teammates look), not under the session ID.
 */
let leaderTeamName: string | undefined

/**
 * Sets the leader's team name for task list resolution.
 * Called by TeamCreateTool when a team is created.
 */
export function setLeaderTeamName(teamName: string): void {
  if (leaderTeamName === teamName) return
  leaderTeamName = teamName
  // Changing the task list ID is a "tasks updated" event for subscribers —
  // they're now looking at a different directory.
  notifyTasksUpdated()
}

/**
 * Clears the leader's team name.
 * Called when a team is deleted.
 */
export function clearLeaderTeamName(): void {
  if (leaderTeamName === undefined) return
  leaderTeamName = undefined
  notifyTasksUpdated()
}

/**
 * Register a listener to be called when tasks are updated in this process.
 * Returns an unsubscribe function.
 */
export const onTasksUpdated = tasksUpdated.subscribe

/**
 * Notify listeners that tasks have been updated.
 * Called internally after createTask, updateTask, etc.
 * Wraps emit in try/catch so listener failures never propagate to callers
 * (task mutations must succeed from the caller's perspective).
 */
export function notifyTasksUpdated(): void {
  try {
    tasksUpdated.emit()
  } catch {
    // Ignore listener errors — task mutations must not fail due to notification issues
  }
}

export const TASK_STATUSES = [
  'pending',
  'in_progress',
  'completed',
  'failed',
  'skipped',
] as const

export const TaskStatusSchema = lazySchema(() =>
  // 'failed' and 'skipped' are produced by crew/workflow runs and rendered
  // by TaskListV2 (✘ / ⚠); the enum previously omitted them so any consumer
  // typed against Task['status'] couldn't reference states that actually
  // occur in task files.
  z.enum(['pending', 'in_progress', 'completed', 'failed', 'skipped']),
)
export type TaskStatus = z.infer<ReturnType<typeof TaskStatusSchema>>

export const TaskSchema = lazySchema(() =>
  z.object({
    id: z.string(),
    subject: z.string(),
    description: z.string(),
    activeForm: z.string().optional(), // present continuous form for spinner (e.g., "Running tests")
    owner: z.string().optional(), // agent ID
    status: TaskStatusSchema(),
    blocks: z.array(z.string()), // task IDs this task blocks
    blockedBy: z.array(z.string()), // task IDs that block this task
    metadata: z.record(z.string(), z.unknown()).optional(), // arbitrary metadata
  }),
)
export type Task = z.infer<ReturnType<typeof TaskSchema>>

// High water mark file name - stores the maximum task ID ever assigned
const HIGH_WATER_MARK_FILE = '.highwatermark'
// Deliberately not a .json suffix: active task readers treat every root-level
// *.json file as a task snapshot, including the strict inspection path.
const ACTIVE_GENERATION_FILE = '.active-generation'
const HISTORY_DIRECTORY = '.history'
const HISTORY_MANIFEST_FILE = '.manifest.json'
const AUTOMATIC_PROMPT_TASK_KEY = 'urAutomaticPromptTask'

/** True only for the internal placeholder shown before semantic tasks exist. */
export function isAutomaticPromptTask(
  task: Pick<Task, 'metadata'>,
): boolean {
  return task.metadata?.[AUTOMATIC_PROMPT_TASK_KEY] === true
}

/**
 * Automatic prompt tasks were synchronization placeholders created by builds
 * through 1.78.13. They were never semantic user work, so current builds hide
 * them immediately and remove their snapshots at the next generation boundary.
 */
export function isTaskVisibleInActiveBoard(
  task: Pick<Task, 'metadata'>,
): boolean {
  return !isAutomaticPromptTask(task)
}

export type TaskListHistoryEntry = {
  archiveId: string
  generationId?: string
  archivedAt: string
  tasks: Task[]
}

/**
 * Parse an allocated task ID without accepting a numeric-looking prefix.
 *
 * Number.parseInt('12-external', 10) returns 12, which previously made an
 * externally-created ID affect ordering, deletion high-water marks, and the
 * next allocated ID. Allocated IDs are decimal safe integers in full.
 */
function parseNumericTaskId(value: string): number | null {
  if (!/^\d+$/u.test(value)) return null
  const numeric = Number(value)
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null
}

// Lock options: retry with backoff so concurrent callers (multiple URs
// in a swarm) wait for the lock instead of failing immediately. The sync
// lockSync API blocked the event loop; the async API needs explicit retries
// to achieve the same serialization semantics.
//
// Budget sized for ~10+ concurrent swarm agents: each critical section does
// readdir + N×readFile + writeFile (~50-100ms on slow disks), so the last
// caller in a 10-way race needs ~900ms. retries=30 gives ~2.6s total wait.
const LOCK_OPTIONS = {
  retries: {
    retries: 30,
    minTimeout: 5,
    maxTimeout: 100,
  },
}

function getHighWaterMarkPath(taskListId: string): string {
  return join(getTasksDir(taskListId), HIGH_WATER_MARK_FILE)
}

function getActiveGenerationPath(taskListId: string): string {
  return join(getTasksDir(taskListId), ACTIVE_GENERATION_FILE)
}

function getTaskHistoryDir(taskListId: string): string {
  return join(getTasksDir(taskListId), HISTORY_DIRECTORY)
}

async function readActiveGeneration(
  taskListId: string,
): Promise<string | undefined> {
  try {
    const parsed: unknown = jsonParse(
      await readFile(getActiveGenerationPath(taskListId), 'utf-8'),
    )
    if (
      parsed &&
      typeof parsed === 'object' &&
      'generationId' in parsed &&
      typeof parsed.generationId === 'string'
    ) {
      return parsed.generationId
    }
  } catch {
    // Missing or malformed metadata is treated as a legacy active list. The
    // task snapshots themselves remain authoritative and are never discarded.
  }
  return undefined
}

async function writeActiveGeneration(
  taskListId: string,
  generationId: string,
): Promise<void> {
  await writeFileAtomically(
    getActiveGenerationPath(taskListId),
    jsonStringify({ generationId }, null, 2),
  )
}

async function readHighWaterMark(taskListId: string): Promise<number> {
  const path = getHighWaterMarkPath(taskListId)
  try {
    const content = (await readFile(path, 'utf-8')).trim()
    return parseNumericTaskId(content) ?? 0
  } catch {
    return 0
  }
}

async function writeHighWaterMark(
  taskListId: string,
  value: number,
): Promise<void> {
  const path = getHighWaterMarkPath(taskListId)
  await writeFileAtomically(path, String(value))
}

export function isTodoV2Enabled(): boolean {
  // Force-enable tasks in non-interactive mode (e.g. SDK users who want Task tools over TodoWrite)
  if (isEnvTruthy(process.env.UR_CODE_ENABLE_TASKS)) {
    return true
  }
  return !getIsNonInteractiveSession()
}

/**
 * Resets the task list for a new swarm - clears any existing tasks.
 * Writes a high water mark file to prevent ID reuse after reset.
 * Should be called when a new swarm is created to ensure task numbering starts at 1.
 * Uses file locking to prevent race conditions when multiple URs run in parallel.
 */
/**
 * Whether every task in a list has finished, so the list represents completed
 * history rather than active work. An empty list is not "completed".
 */
export function isTaskListFullyCompleted(tasks: Task[]): boolean {
  return tasks.length > 0 && tasks.every(task => task.status === 'completed')
}

type ArchiveManifest = {
  archiveId: string
  generationId?: string
  archivedAt: string
  taskIds: string[]
}

/**
 * Move the active snapshots into immutable history while holding the list
 * lock. Every move is atomic on the same filesystem. If a move or manifest
 * write fails, completed moves are rolled back before the error is surfaced.
 */
async function archiveActiveTaskListUnsafe(
  taskListId: string,
  generationId: string | undefined,
): Promise<TaskListHistoryEntry | undefined> {
  const tasks = await listTasks(taskListId)
  if (tasks.length === 0) return undefined

  const highestId = await findHighestTaskIdFromFiles(taskListId)
  if (highestId > 0) {
    const currentMark = await readHighWaterMark(taskListId)
    if (highestId > currentMark) await writeHighWaterMark(taskListId, highestId)
  }

  const archiveId = `${Date.now().toString(36)}-${randomUUID()}`
  const archivedAt = new Date().toISOString()
  const archiveDir = join(getTaskHistoryDir(taskListId), archiveId)
  await mkdir(archiveDir, { recursive: true })

  const moved: Array<{ from: string; to: string }> = []
  try {
    for (const task of tasks) {
      const from = getTaskPath(taskListId, task.id)
      const to = join(archiveDir, `${sanitizePathComponent(task.id)}.json`)
      await rename(from, to)
      moved.push({ from, to })
    }
    const manifest: ArchiveManifest = {
      archiveId,
      generationId,
      archivedAt,
      taskIds: tasks.map(task => task.id),
    }
    await writeFileAtomically(
      join(archiveDir, HISTORY_MANIFEST_FILE),
      jsonStringify(manifest, null, 2),
    )
    return { archiveId, generationId, archivedAt, tasks }
  } catch (error) {
    for (const item of moved.reverse()) {
      await rename(item.to, item.from).catch(() => undefined)
    }
    await unlink(join(archiveDir, HISTORY_MANIFEST_FILE)).catch(() => undefined)
    await rmdir(archiveDir).catch(() => undefined)
    throw error
  }
}

async function withTaskListLock<T>(
  taskListId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lockPath = await ensureTaskListLockFile(taskListId)
  let release: (() => Promise<void>) | undefined
  try {
    release = await lockfile.lock(lockPath, LOCK_OPTIONS)
    return await operation()
  } finally {
    await release?.()
  }
}

function hasUnfinishedWork(tasks: readonly Task[]): boolean {
  return tasks.some(
    task =>
      !isAutomaticPromptTask(task) &&
      (task.status === 'pending' || task.status === 'in_progress'),
  )
}

/**
 * Remove non-semantic planning placeholders left by older builds while the
 * task-list lock is held. Preserve the ID high-water mark and clean any
 * defensive dependency references so migration cannot create dangling edges.
 */
async function removeLegacyAutomaticPromptTasksUnsafe(
  taskListId: string,
  tasks: readonly Task[],
): Promise<{ tasks: Task[]; removed: boolean }> {
  const automaticTasks = tasks.filter(isAutomaticPromptTask)
  if (automaticTasks.length === 0) {
    return { tasks: [...tasks], removed: false }
  }

  const highestAutomaticId = automaticTasks.reduce((highest, task) => {
    const numeric = parseNumericTaskId(task.id)
    return numeric === null ? highest : Math.max(highest, numeric)
  }, 0)
  if (highestAutomaticId > 0) {
    const currentMark = await readHighWaterMark(taskListId)
    if (highestAutomaticId > currentMark) {
      await writeHighWaterMark(taskListId, highestAutomaticId)
    }
  }

  const removedIds = new Set(automaticTasks.map(task => task.id))
  const remaining: Task[] = []
  for (const task of tasks) {
    if (removedIds.has(task.id)) continue
    const blocks = task.blocks.filter(id => !removedIds.has(id))
    const blockedBy = task.blockedBy.filter(id => !removedIds.has(id))
    const cleaned =
      blocks.length === task.blocks.length &&
      blockedBy.length === task.blockedBy.length
        ? task
        : { ...task, blocks, blockedBy }
    if (cleaned !== task) {
      await writeTaskSnapshotUnsafe(taskListId, cleaned)
    }
    remaining.push(cleaned)
  }
  for (const task of automaticTasks) {
    await unlink(getTaskPath(taskListId, task.id)).catch(() => undefined)
  }
  return { tasks: remaining, removed: true }
}

/**
 * Move the list to a new prompt generation without losing interrupted work.
 * A list is archived only after it has no pending/in-progress tasks. This
 * makes a user message received mid-run an update to the visible board instead
 * of silently moving the work to history.
 */
async function establishTaskListGenerationUnsafe(
  taskListId: string,
  generationId: string,
  options: { appendToCurrent?: boolean } = {},
): Promise<{ changed: boolean; archived?: TaskListHistoryEntry }> {
  const activeGeneration = await readActiveGeneration(taskListId)
  const legacyCleanup = await removeLegacyAutomaticPromptTasksUnsafe(
    taskListId,
    await listTasks(taskListId),
  )
  if (activeGeneration === generationId) {
    return { changed: legacyCleanup.removed }
  }

  const activeTasks = legacyCleanup.tasks
  const keepCurrent =
    options.appendToCurrent === true || hasUnfinishedWork(activeTasks)
  const archived = keepCurrent
    ? undefined
    : await archiveActiveTaskListUnsafe(taskListId, activeGeneration)
  await writeActiveGeneration(taskListId, generationId)
  return { changed: true, archived }
}

/**
 * Establish a fresh active generation for one accepted user prompt. An
 * explicit append request keeps the current snapshots but still records the
 * new generation, so parallel TaskCreate calls in that turn cannot retire one
 * another's work.
 */
export async function prepareTaskListForRun(
  taskListId: string,
  generationId: string,
  options: { appendToCurrent?: boolean } = {},
): Promise<TaskListHistoryEntry | undefined> {
  const result = await withTaskListLock(taskListId, async () => {
    return establishTaskListGenerationUnsafe(
      taskListId,
      generationId,
      options,
    )
  })
  if (result.changed) notifyTasksUpdated()
  return result.archived
}

/**
 * Archive a completed list without deleting it. Retained for callers that
 * explicitly retire finished work; new prompt generations use
 * prepareTaskListForRun so incomplete stale work is historical too.
 */
export async function retireCompletedTaskList(
  taskListId: string,
): Promise<boolean> {
  const retired = await withTaskListLock(taskListId, async () => {
    const tasks = await listTasks(taskListId)
    if (!isTaskListFullyCompleted(tasks)) return false
    await archiveActiveTaskListUnsafe(
      taskListId,
      await readActiveGeneration(taskListId),
    )
    await unlink(getActiveGenerationPath(taskListId)).catch(() => undefined)
    return true
  })
  if (retired) notifyTasksUpdated()
  return retired
}

/** Read archived task lists without mixing them into active progress. */
export async function listTaskHistory(
  taskListId: string,
): Promise<TaskListHistoryEntry[]> {
  const historyDir = getTaskHistoryDir(taskListId)
  let entries: Dirent[]
  try {
    entries = await readdir(historyDir, { withFileTypes: true })
  } catch {
    return []
  }

  const history = await Promise.all(
    entries
      .filter(entry => entry.isDirectory())
      .map(async (entry): Promise<TaskListHistoryEntry | undefined> => {
        const archiveDir = join(historyDir, entry.name)
        try {
          const manifest = jsonParse(
            await readFile(join(archiveDir, HISTORY_MANIFEST_FILE), 'utf-8'),
          ) as Partial<ArchiveManifest>
          if (
            manifest.archiveId !== entry.name ||
            typeof manifest.archivedAt !== 'string' ||
            !Array.isArray(manifest.taskIds)
          ) {
            return undefined
          }
          const tasks = await Promise.all(
            manifest.taskIds.map(async taskId => {
              if (typeof taskId !== 'string') return undefined
              const value = migrateLegacyTaskData(
                jsonParse(
                  await readFile(
                    join(archiveDir, `${sanitizePathComponent(taskId)}.json`),
                    'utf-8',
                  ),
                ),
              )
              const parsed = TaskSchema().safeParse(value)
              return parsed.success ? parsed.data : undefined
            }),
          )
          if (tasks.some(task => task === undefined)) return undefined
          return {
            archiveId: entry.name,
            generationId:
              typeof manifest.generationId === 'string'
                ? manifest.generationId
                : undefined,
            archivedAt: manifest.archivedAt,
            tasks: tasks as Task[],
          }
        } catch (error) {
          logForDebugging(
            `[Tasks] Failed to read task history ${entry.name}: ${errorMessage(error)}`,
          )
          return undefined
        }
      }),
  )
  return history
    .filter((entry): entry is TaskListHistoryEntry => entry !== undefined)
    .sort((a, b) => a.archivedAt.localeCompare(b.archivedAt))
}

export async function resetTaskList(taskListId: string): Promise<void> {
  const dir = getTasksDir(taskListId)
  const lockPath = await ensureTaskListLockFile(taskListId)

  let release: (() => Promise<void>) | undefined
  try {
    // Acquire exclusive lock on the task list
    release = await lockfile.lock(lockPath, LOCK_OPTIONS)

    // Find the current highest ID and save it to the high water mark file
    const currentHighest = await findHighestTaskIdFromFiles(taskListId)
    if (currentHighest > 0) {
      const existingMark = await readHighWaterMark(taskListId)
      if (currentHighest > existingMark) {
        await writeHighWaterMark(taskListId, currentHighest)
      }
    }

    // Delete all task files
    let files: string[]
    try {
      files = await readdir(dir)
    } catch {
      files = []
    }
    for (const file of files) {
      if (file.endsWith('.json') && !file.startsWith('.')) {
        const filePath = join(dir, file)
        try {
          await unlink(filePath)
        } catch {
          // Ignore errors, file may already be deleted
        }
      }
    }
    await unlink(getActiveGenerationPath(taskListId)).catch(() => undefined)
    notifyTasksUpdated()
  } finally {
    if (release) {
      await release()
    }
  }
}

/**
 * Gets the task list ID based on the current context.
 * Priority:
 * 1. UR_CODE_TASK_LIST_ID - explicit task list ID
 * 2. In-process teammate: leader's team name (so teammates share the leader's task list)
 * 3. UR_CODE_TEAM_NAME - set when running as a process-based teammate
 * 4. Leader team name - set when the leader creates a team via TeamCreate
 * 5. Session ID - fallback for standalone sessions
 */
export function getTaskListId(): string {
  if (process.env.UR_CODE_TASK_LIST_ID) {
    return process.env.UR_CODE_TASK_LIST_ID
  }
  // In-process teammates use the leader's team name so they share the same
  // task list that tmux/iTerm2 teammates also resolve to.
  const teammateCtx = getTeammateContext()
  if (teammateCtx) {
    return teammateCtx.teamName
  }
  return getTeamName() || leaderTeamName || getSessionId()
}

/**
 * Sanitizes a string for safe use in file paths.
 * Removes path traversal characters and other potentially dangerous characters.
 * Only allows alphanumeric characters, hyphens, and underscores.
 */
export function sanitizePathComponent(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, '-')
}

export function getTasksDir(taskListId: string): string {
  return join(
    getURConfigHomeDir(),
    'tasks',
    sanitizePathComponent(taskListId),
  )
}

export function getTaskPath(taskListId: string, taskId: string): string {
  return join(getTasksDir(taskListId), `${sanitizePathComponent(taskId)}.json`)
}

export async function ensureTasksDir(taskListId: string): Promise<void> {
  const dir = getTasksDir(taskListId)
  try {
    await mkdir(dir, { recursive: true })
  } catch {
    // Directory already exists or creation failed; callers will surface
    // errors from subsequent operations.
  }
}

/**
 * Finds the highest task ID from existing task files (not including high water mark).
 */
async function findHighestTaskIdFromFiles(taskListId: string): Promise<number> {
  const dir = getTasksDir(taskListId)
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return 0
  }
  let highest = 0
  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue
    }
    const taskId = parseNumericTaskId(file.slice(0, -'.json'.length))
    if (taskId !== null && taskId > highest) {
      highest = taskId
    }
  }
  return highest
}

/**
 * Finds the highest task ID ever assigned, considering both existing files
 * and the high water mark (for deleted/reset tasks).
 */
async function findHighestTaskId(taskListId: string): Promise<number> {
  const [fromFiles, fromMark] = await Promise.all([
    findHighestTaskIdFromFiles(taskListId),
    readHighWaterMark(taskListId),
  ])
  return Math.max(fromFiles, fromMark)
}

/**
 * Creates a new task with a unique ID.
 * Uses file locking to prevent race conditions when multiple processes
 * create tasks concurrently.
 */
export async function createTask(
  taskListId: string,
  taskData: Omit<Task, 'id'>,
): Promise<string> {
  const lockPath = await ensureTaskListLockFile(taskListId)

  let release: (() => Promise<void>) | undefined
  try {
    // Acquire exclusive lock on the task list
    release = await lockfile.lock(lockPath, LOCK_OPTIONS)

    // Read highest ID from disk while holding the lock
    const highestId = await findHighestTaskId(taskListId)
    if (highestId >= Number.MAX_SAFE_INTEGER) {
      throw new Error('Task ID space is exhausted')
    }
    const id = String(highestId + 1)
    const task = adoptForwardTaskDependencies(
      id,
      taskData,
      await listTasks(taskListId),
    )
    await writeTaskSnapshotUnsafe(taskListId, task)
    notifyTasksUpdated()
    return id
  } finally {
    if (release) {
      await release()
    }
  }
}

/**
 * Atomically establish a prompt generation and create its task. This closes
 * the old listTasks → reset/archive → create TOCTOU window when multiple
 * independent TaskCreate calls are emitted in one model response.
 */
export async function createTaskForRun(
  taskListId: string,
  generationId: string,
  taskData: Omit<Task, 'id'>,
  options: {
    appendToCurrent?: boolean
  } = {},
): Promise<string> {
  const id = await withTaskListLock(taskListId, async () => {
    await establishTaskListGenerationUnsafe(taskListId, generationId, options)

    return allocateTaskSnapshotUnsafe(
      taskListId,
      taskData,
      await listTasks(taskListId),
    )
  })
  notifyTasksUpdated()
  return id
}

/**
 * Complete the missing half of edges that referenced an ID before allocation.
 *
 * An earlier task can either block this task (`earlier.blocks` contains id) or
 * be blocked by it (`earlier.blockedBy` contains id). The existing snapshot is
 * already the durable half of that edge; creation supplies the reciprocal half
 * so all graph readers see the same relationship once both endpoints exist.
 */
function adoptForwardTaskDependencies(
  id: string,
  taskData: Omit<Task, 'id'>,
  existingTasks: readonly Task[],
): Task {
  const adoptedBlocks = existingTasks
    .filter(existing => existing.blockedBy.includes(id))
    .map(existing => existing.id)
  const adoptedBlockedBy = existingTasks
    .filter(existing => existing.blocks.includes(id))
    .map(existing => existing.id)

  return {
    id,
    ...taskData,
    blocks: [...new Set([...taskData.blocks, ...adoptedBlocks])],
    blockedBy: [
      ...new Set([...taskData.blockedBy, ...adoptedBlockedBy]),
    ],
  }
}

async function allocateTaskSnapshotUnsafe(
  taskListId: string,
  taskData: Omit<Task, 'id'>,
  existingTasks: readonly Task[],
): Promise<string> {
  const highestId = await findHighestTaskId(taskListId)
  if (highestId >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Task ID space is exhausted')
  }
  const taskId = String(highestId + 1)
  const task = adoptForwardTaskDependencies(taskId, taskData, existingTasks)
  await writeTaskSnapshotUnsafe(taskListId, task)
  return taskId
}

export async function getTask(
  taskListId: string,
  taskId: string,
): Promise<Task | null> {
  const path = getTaskPath(taskListId, taskId)
  try {
    const content = await readFile(path, 'utf-8')
    const data = migrateLegacyTaskData(jsonParse(content))
    const parsed = TaskSchema().safeParse(data)
    if (!parsed.success) {
      logForDebugging(
        `[Tasks] Task ${taskId} failed schema validation: ${parsed.error.message}`,
      )
      return null
    }
    return parsed.data
  } catch (e) {
    const code = getErrnoCode(e)
    if (code === 'ENOENT') {
      return null
    }
    logForDebugging(`[Tasks] Failed to read task ${taskId}: ${errorMessage(e)}`)
    logError(e)
    return null
  }
}

function migrateLegacyTaskData(value: unknown): unknown {
  if (
    process.env.USER_TYPE !== 'ant' ||
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return value
  }
  const data = { ...(value as Record<string, unknown>) }
  if (data.status === 'open') data.status = 'pending'
  else if (data.status === 'resolved') data.status = 'completed'
  else if (
    typeof data.status === 'string' &&
    ['planning', 'implementing', 'reviewing', 'verifying'].includes(
      data.status,
    )
  ) {
    data.status = 'in_progress'
  }
  return data
}

// Internal: no lock. Callers already holding a lock on taskPath must use this
// to avoid deadlock (claimTask, deleteTask cascade, etc.).
async function updateTaskUnsafe(
  taskListId: string,
  taskId: string,
  updates: Partial<Omit<Task, 'id'>>,
): Promise<Task | null> {
  const existing = await getTask(taskListId, taskId)
  if (!existing) {
    return null
  }
  const updated: Task = { ...existing, ...updates, id: taskId }
  await writeTaskSnapshotUnsafe(taskListId, updated)
  notifyTasksUpdated()
  return updated
}

async function writeFileAtomically(path: string, content: string): Promise<void> {
  const temporaryPath =
    `${path}.${process.pid}.${randomUUID().replaceAll('-', '')}.tmp`
  let handle: Awaited<ReturnType<typeof open>> | undefined
  let renamed = false
  try {
    handle = await open(temporaryPath, 'wx', 0o600)
    await handle.writeFile(content, { encoding: 'utf-8' })
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporaryPath, path)
    renamed = true
  } finally {
    await handle?.close().catch(() => undefined)
    if (!renamed) {
      await unlink(temporaryPath).catch(() => undefined)
    }
  }
}

async function writeTaskSnapshotUnsafe(
  taskListId: string,
  task: Task,
): Promise<void> {
  await writeFileAtomically(
    getTaskPath(taskListId, task.id),
    jsonStringify(task, null, 2),
  )
}

export async function updateTask(
  taskListId: string,
  taskId: string,
  updates: Partial<Omit<Task, 'id'>>,
): Promise<Task | null> {
  const path = getTaskPath(taskListId, taskId)

  // Check existence before locking — proper-lockfile throws if the
  // target file doesn't exist, and we want a clean null result.
  const taskBeforeLock = await getTask(taskListId, taskId)
  if (!taskBeforeLock) {
    return null
  }

  let release: (() => Promise<void>) | undefined
  try {
    release = await lockfile.lock(path, LOCK_OPTIONS)
    return await updateTaskUnsafe(taskListId, taskId, updates)
  } finally {
    await release?.()
  }
}

export async function deleteTask(
  taskListId: string,
  taskId: string,
): Promise<boolean> {
  const path = getTaskPath(taskListId, taskId)
  const listLockPath = await ensureTaskListLockFile(taskListId)
  let releaseList: (() => Promise<void>) | undefined
  const taskReleases: Array<() => Promise<void>> = []

  try {
    // Coordinate deletion with createTask/resetTaskList/blockTask so a
    // dependency cannot be validated against a task that disappears before
    // the reciprocal edges are committed.
    releaseList = await lockfile.lock(listLockPath, LOCK_OPTIONS)
    const initialTasks = await listTasks(taskListId)
    if (!initialTasks.some(task => task.id === taskId)) return false

    // Lock the target and every task that currently references it. Cleanup is
    // committed before unlinking the target, so an I/O failure cannot leave a
    // missing task with dangling graph edges.
    const affectedPaths = initialTasks
      .map(task => getTaskPath(taskListId, task.id))
      .sort()
    for (const affectedPath of affectedPaths) {
      taskReleases.push(
        await lockfile.lock(affectedPath, LOCK_OPTIONS),
      )
    }

    const allTasks = await listTasks(taskListId)
    const target = allTasks.find(task => task.id === taskId)
    if (!target) return false
    const affectedTasks = allTasks.filter(
      task =>
        task.id !== taskId &&
        (task.blocks.includes(taskId) || task.blockedBy.includes(taskId)),
    )

    // Update high water mark before deleting to prevent ID reuse
    const numericId = parseNumericTaskId(taskId)
    if (numericId !== null) {
      const currentMark = await readHighWaterMark(taskListId)
      if (numericId > currentMark) {
        await writeHighWaterMark(taskListId, numericId)
      }
    }

    const writtenSnapshots: Task[] = []
    try {
      for (const task of affectedTasks) {
        const cleaned: Task = {
          ...task,
          blocks: task.blocks.filter(id => id !== taskId),
          blockedBy: task.blockedBy.filter(id => id !== taskId),
        }
        await writeTaskSnapshotUnsafe(taskListId, cleaned)
        writtenSnapshots.push(task)
      }

      // Unlink last: once the target is gone, every persisted graph reference
      // to it has already been removed.
      await unlink(path)
    } catch (e) {
      // Restore any cleanup already written while the target still exists.
      for (const snapshot of writtenSnapshots.reverse()) {
        try {
          await writeTaskSnapshotUnsafe(taskListId, snapshot)
        } catch (rollbackError) {
          logForDebugging(
            `[Tasks] Failed to roll back deletion of task ${taskId}: ` +
              errorMessage(rollbackError),
          )
          logError(rollbackError)
        }
      }
      const code = getErrnoCode(e)
      if (code === 'ENOENT') {
        return false
      }
      throw e
    }

    notifyTasksUpdated()
    return true
  } catch (error) {
    logForDebugging(
      `[Tasks] Failed to delete task ${taskId}: ${errorMessage(error)}`,
    )
    logError(error)
    return false
  } finally {
    for (const release of taskReleases.reverse()) {
      await release().catch(() => undefined)
    }
    await releaseList?.().catch(() => undefined)
  }
}

/**
 * Order task IDs the way they were allocated: ascending integers.
 *
 * Non-numeric IDs are possible for externally-created lists, so those fall
 * back to a stable string comparison and sort after the numeric ones rather
 * than producing NaN comparisons, which leave the order unspecified.
 */
export function compareTaskIds(a: string, b: string): number {
  const left = parseNumericTaskId(a)
  const right = parseNumericTaskId(b)
  const leftIsNumeric = left !== null
  const rightIsNumeric = right !== null
  if (left !== null && right !== null) {
    return left === right ? a.localeCompare(b) : left - right
  }
  if (leftIsNumeric) return -1
  if (rightIsNumeric) return 1
  return a.localeCompare(b)
}

export async function listTasks(taskListId: string): Promise<Task[]> {
  const dir = getTasksDir(taskListId)
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return []
  }
  const taskIds = files
    .filter(f => f.endsWith('.json'))
    .map(f => f.slice(0, -'.json'.length))
    // readdir returns filesystem order, which is lexicographic in practice:
    // past nine tasks that reads 1, 10, 11, 12, ... 2, 20, 3. IDs are
    // allocated as ascending integers, so sort them as integers. Promise.all
    // preserves input order, so this is the only place the order is decided.
    .sort(compareTaskIds)
  const results = await Promise.all(taskIds.map(id => getTask(taskListId, id)))
  return results.filter((t): t is Task => t !== null)
}

export type TaskListGateInspection = {
  /** All schema-valid task snapshots, in the same numeric order as listTasks. */
  tasks: Task[]
  /** Total persisted task snapshots. Gate policy may further filter by status. */
  taskCount: number
}

/**
 * Strict task-store read for the mutation gate.
 *
 * The normal listTasks API intentionally remains forgiving for UI callers:
 * a broken file is logged and omitted. A safety gate cannot treat corruption
 * or an I/O failure as proof that no plan exists, so this variant only maps a
 * missing task-list directory (ENOENT from readdir) to an empty list. Every
 * task-file read, JSON parse, schema, and filename/id mismatch is surfaced.
 */
export async function inspectTaskListForGate(
  taskListId: string,
): Promise<TaskListGateInspection> {
  const dir = getTasksDir(taskListId)
  let files: string[]
  try {
    files = await readdir(dir)
  } catch (error) {
    if (getErrnoCode(error) === 'ENOENT') {
      return { tasks: [], taskCount: 0 }
    }
    throw error
  }

  const taskIds = files
    .filter(file => file.endsWith('.json'))
    .map(file => file.slice(0, -'.json'.length))
    .sort(compareTaskIds)
  const tasks = await Promise.all(
    taskIds.map(async taskId => {
      const content = await readFile(getTaskPath(taskListId, taskId), 'utf-8')
      const task = TaskSchema().parse(
        migrateLegacyTaskData(jsonParse(content)),
      )
      if (task.id !== taskId) {
        throw new Error(
          `Task file ${taskId}.json contains mismatched task id ${task.id}`,
        )
      }
      return task
    }),
  )
  return { tasks, taskCount: tasks.length }
}

export type TaskDependencyValidation =
  | { valid: true }
  | {
    valid: false
    reason: 'task_not_found' | 'self_dependency' | 'cycle'
  }

export type TaskDependencyEdge = {
  fromTaskId: string
  toTaskId: string
}

type TaskDependencyFailureReason = Extract<
  TaskDependencyValidation,
  { valid: false }
>['reason']

export type TaskDependencyBatchValidation =
  | { success: true }
  | {
    success: false
    reason: TaskDependencyFailureReason
    dependency: TaskDependencyEdge
  }

export type TaskDependencyBatchResult =
  | { success: true; task: Task }
  | {
    success: false
    reason: TaskDependencyFailureReason | 'blocked' | 'write_failed'
    dependency?: TaskDependencyEdge
    blockedBy?: string[]
  }

function cloneTask(task: Task): Task {
  return {
    ...task,
    blocks: [...task.blocks],
    blockedBy: [...task.blockedBy],
    metadata: task.metadata ? { ...task.metadata } : undefined,
  }
}

export function validateTaskDependencyInSnapshot(
  tasks: Task[],
  fromTaskId: string,
  toTaskId: string,
): TaskDependencyValidation {
  if (fromTaskId === toTaskId) {
    return { valid: false, reason: 'self_dependency' }
  }

  const byId = new Map(tasks.map(task => [task.id, task]))
  const fromTask = byId.get(fromTaskId)
  const toTask = byId.get(toTaskId)
  // A dependency on a task that does not exist *yet* is a forward reference,
  // which is how a plan arrives while the list is still being built. Either
  // endpoint can be the future task: `blocks` makes it the target, while
  // `blockedBy` makes it the source. Rejecting the latter was the reason a
  // perfectly ordinary `blockedBy: ["8"]` still failed after forward targets
  // had supposedly been enabled.
  //
  // IDs are allocated as consecutive integers, so a missing endpoint above
  // the highest one issued can still arrive. A missing ID at or below that
  // point is deleted/stale, and a non-numeric ID is a typo. At least one side
  // must exist so there is a task snapshot on which to persist the pending
  // half-edge.
  const highestIssued = tasks.reduce((highest, task) => {
    const numeric = parseNumericTaskId(task.id)
    return numeric === null ? highest : Math.max(highest, numeric)
  }, 0)
  const isFutureId = (id: string): boolean => {
    const numeric = parseNumericTaskId(id)
    return numeric !== null && numeric > highestIssued
  }
  if (!fromTask && !toTask) {
    return { valid: false, reason: 'task_not_found' }
  }
  if ((!fromTask && !isFutureId(fromTaskId)) ||
      (!toTask && !isFutureId(toTaskId))) {
    return { valid: false, reason: 'task_not_found' }
  }

  // Build the conceptual graph, including virtual nodes named by pending
  // half-edges. Looking only at existing `blocks` misses an edge stored as
  // `blockedBy` on its existing target and can admit a cycle that becomes real
  // as soon as the future task is created.
  const adjacency = new Map<string, Set<string>>()
  const addEdge = (from: string, to: string): void => {
    const targets = adjacency.get(from) ?? new Set<string>()
    targets.add(to)
    adjacency.set(from, targets)
  }
  for (const task of tasks) {
    for (const target of task.blocks) addEdge(task.id, target)
    for (const blocker of task.blockedBy) addEdge(blocker, task.id)
  }
  if (adjacency.get(fromTaskId)?.has(toTaskId)) {
    return { valid: true }
  }

  // Adding A -> B creates a cycle exactly when B already reaches A.
  const pending = [toTaskId]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const currentId = pending.pop()!
    if (currentId === fromTaskId) {
      return { valid: false, reason: 'cycle' }
    }
    if (visited.has(currentId)) continue
    visited.add(currentId)
    pending.push(...(adjacency.get(currentId) ?? []))
  }
  return { valid: true }
}

function applyTaskDependenciesToSnapshot(
  tasks: Task[],
  dependencies: readonly TaskDependencyEdge[],
):
  | { success: true; tasks: Task[] }
  | {
    success: false
    reason: TaskDependencyFailureReason
    dependency: TaskDependencyEdge
  } {
  const clonedTasks = tasks.map(cloneTask)
  const byId = new Map(clonedTasks.map(task => [task.id, task]))

  for (const dependency of dependencies) {
    const validation = validateTaskDependencyInSnapshot(
      clonedTasks,
      dependency.fromTaskId,
      dependency.toTaskId,
    )
    if (validation.valid === false) {
      return {
        success: false,
        reason: validation.reason,
        dependency,
      }
    }

    const fromTask = byId.get(dependency.fromTaskId)
    const toTask = byId.get(dependency.toTaskId)
    // A forward edge has only one persisted endpoint. Creation of the missing
    // task adopts the reciprocal side through adoptForwardTaskDependencies.
    if (fromTask && !fromTask.blocks.includes(dependency.toTaskId)) {
      fromTask.blocks.push(dependency.toTaskId)
    }
    if (toTask && !toTask.blockedBy.includes(dependency.fromTaskId)) {
      toTask.blockedBy.push(dependency.fromTaskId)
    }
  }

  return { success: true, tasks: clonedTasks }
}

/**
 * Validate an A -> B dependency ("A blocks B") before writing either half of
 * the reciprocal relationship.
 */
export async function validateTaskDependency(
  taskListId: string,
  fromTaskId: string,
  toTaskId: string,
): Promise<TaskDependencyValidation> {
  const tasks = await listTasks(taskListId)
  return validateTaskDependencyInSnapshot(tasks, fromTaskId, toTaskId)
}

/**
 * Validate a whole proposed dependency batch against one evolving snapshot.
 * This catches cycles that only exist when two individually-valid edges are
 * combined in the same TaskCreate/TaskUpdate call.
 */
export async function validateTaskDependencies(
  taskListId: string,
  dependencies: readonly TaskDependencyEdge[],
): Promise<TaskDependencyBatchValidation> {
  const tasks = await listTasks(taskListId)
  const result = applyTaskDependenciesToSnapshot(tasks, dependencies)
  if (result.success === false) return result
  return { success: true }
}

/**
 * Atomically (within this filesystem task store) update one task and add a
 * batch of reciprocal dependency edges. All proposed edges are validated
 * together under the task-list lock, all affected task files are locked in a
 * stable order, and already-written files are restored if a later write fails.
 */
export async function updateTaskWithDependencies(
  taskListId: string,
  taskId: string,
  updates: Partial<Omit<Task, 'id'>>,
  dependencies: readonly TaskDependencyEdge[],
): Promise<TaskDependencyBatchResult> {
  const listLockPath = await ensureTaskListLockFile(taskListId)
  let releaseList: (() => Promise<void>) | undefined
  const taskReleases: Array<() => Promise<void>> = []

  try {
    releaseList = await lockfile.lock(listLockPath, LOCK_OPTIONS)
    const initialTasks = await listTasks(taskListId)
    const initialById = new Map(initialTasks.map(task => [task.id, task]))
    if (!initialById.has(taskId)) {
      return { success: false, reason: 'task_not_found' }
    }

    // Lock the full snapshot. A cycle can traverse tasks not named directly
    // in this request, so locking only the endpoints would allow an ordinary
    // graph update on an intermediate task to invalidate validation.
    const taskPaths = initialTasks
      .map(initialTask => getTaskPath(taskListId, initialTask.id))
      .sort()
    for (const taskPath of taskPaths) {
      taskReleases.push(await lockfile.lock(taskPath, LOCK_OPTIONS))
    }

    // Re-read after acquiring the per-task locks so ordinary field updates
    // that started before this transaction are included rather than lost.
    const originalTasks = await listTasks(taskListId)
    const applied = applyTaskDependenciesToSnapshot(
      originalTasks,
      dependencies,
    )
    if (applied.success === false) return applied

    const updatedById = new Map(applied.tasks.map(task => [task.id, task]))
    const task = updatedById.get(taskId)
    if (!task) return { success: false, reason: 'task_not_found' }
    if (updates.status === 'completed') {
      const unresolvedBlockers = task.blockedBy.filter(blockerId => {
        const blocker = updatedById.get(blockerId)
        return blocker !== undefined && blocker.status !== 'completed'
      })
      if (unresolvedBlockers.length > 0) {
        return {
          success: false,
          reason: 'blocked',
          blockedBy: unresolvedBlockers,
        }
      }
    }
    const updatedTask = TaskSchema().parse({
      ...task,
      ...updates,
      id: taskId,
    })
    updatedById.set(taskId, updatedTask)

    const originalById = new Map(
      originalTasks.map(originalTask => [originalTask.id, originalTask]),
    )
    const changedTasks = [...updatedById.values()].filter(candidate => {
      const original = originalById.get(candidate.id)
      return original !== undefined &&
        jsonStringify(original) !== jsonStringify(candidate)
    })

    const writtenSnapshots: Task[] = []
    try {
      for (const changedTask of changedTasks) {
        const original = originalById.get(changedTask.id)!
        await writeTaskSnapshotUnsafe(taskListId, changedTask)
        writtenSnapshots.push(original)
      }
    } catch (error) {
      for (const snapshot of writtenSnapshots.reverse()) {
        try {
          await writeTaskSnapshotUnsafe(taskListId, snapshot)
        } catch (rollbackError) {
          logForDebugging(
            `[Tasks] Failed to roll back task graph update for #${taskId}: ` +
              errorMessage(rollbackError),
          )
          logError(rollbackError)
        }
      }
      logForDebugging(
        `[Tasks] Failed to update task graph for #${taskId}: ` +
          errorMessage(error),
      )
      logError(error)
      return { success: false, reason: 'write_failed' }
    }

    if (changedTasks.length > 0) notifyTasksUpdated()
    return { success: true, task: updatedTask }
  } catch (error) {
    logForDebugging(
      `[Tasks] Failed to lock task graph for #${taskId}: ` +
        errorMessage(error),
    )
    logError(error)
    return { success: false, reason: 'write_failed' }
  } finally {
    for (const release of taskReleases.reverse()) {
      await release().catch(() => undefined)
    }
    await releaseList?.().catch(() => undefined)
  }
}

export async function blockTask(
  taskListId: string,
  fromTaskId: string,
  toTaskId: string,
): Promise<boolean> {
  const result = await updateTaskWithDependencies(
    taskListId,
    fromTaskId,
    {},
    [{ fromTaskId, toTaskId }],
  )
  return result.success
}

export type ClaimTaskResult = {
  success: boolean
  reason?:
    | 'task_not_found'
    | 'already_claimed'
    | 'already_resolved'
    | 'blocked'
    | 'agent_busy'
  task?: Task
  busyWithTasks?: string[] // task IDs the agent is busy with (when reason is 'agent_busy')
  blockedByTasks?: string[] // task IDs blocking this task (when reason is 'blocked')
}

/**
 * Gets the lock file path for a task list (used for list-level locking)
 */
function getTaskListLockPath(taskListId: string): string {
  return join(getTasksDir(taskListId), '.lock')
}

/**
 * Ensures the lock file exists for a task list
 */
async function ensureTaskListLockFile(taskListId: string): Promise<string> {
  await ensureTasksDir(taskListId)
  const lockPath = getTaskListLockPath(taskListId)
  // proper-lockfile requires the target file to exist. Create it with the
  // 'wx' flag (write-exclusive) so concurrent callers don't both create it,
  // and the first one to create wins silently.
  try {
    await writeFile(lockPath, '', { flag: 'wx' })
  } catch {
    // EEXIST or other — file already exists, which is fine.
  }
  return lockPath
}

export type ClaimTaskOptions = {
  /**
   * If true, checks whether the agent is already busy (owns other open tasks)
   * before allowing the claim. This check is performed atomically with the claim
   * using a task-list-level lock to prevent TOCTOU race conditions.
   */
  checkAgentBusy?: boolean
}

/**
 * Attempts to claim a task for an agent with file locking to prevent race conditions.
 * Returns success if the task was claimed, or a reason if it wasn't.
 *
 * When checkAgentBusy is true, uses a task-list-level lock to atomically check
 * if the agent owns any other open tasks before claiming.
 */
export async function claimTask(
  taskListId: string,
  taskId: string,
  claimantAgentId: string,
  options: ClaimTaskOptions = {},
): Promise<ClaimTaskResult> {
  const taskPath = getTaskPath(taskListId, taskId)

  // Check existence before locking — proper-lockfile.lock throws if the
  // target file doesn't exist, and we want a clean task_not_found result.
  const taskBeforeLock = await getTask(taskListId, taskId)
  if (!taskBeforeLock) {
    return { success: false, reason: 'task_not_found' }
  }

  // If we need to check agent busy status, use task-list-level lock
  // to prevent TOCTOU race conditions
  if (options.checkAgentBusy) {
    return claimTaskWithBusyCheck(taskListId, taskId, claimantAgentId)
  }

  // Otherwise, use task-level lock (original behavior)
  let release: (() => Promise<void>) | undefined
  try {
    // Acquire exclusive lock on the task file
    release = await lockfile.lock(taskPath, LOCK_OPTIONS)

    // Read current task state
    const task = await getTask(taskListId, taskId)
    if (!task) {
      return { success: false, reason: 'task_not_found' }
    }

    // Check if already claimed by another agent
    if (task.owner && task.owner !== claimantAgentId) {
      return { success: false, reason: 'already_claimed', task }
    }

    // Check if already resolved
    if (task.status === 'completed') {
      return { success: false, reason: 'already_resolved', task }
    }

    // Check for unresolved blockers (open or in_progress tasks block)
    const allTasks = await listTasks(taskListId)
    const unresolvedTaskIds = new Set(
      allTasks.filter(t => t.status !== 'completed').map(t => t.id),
    )
    const blockedByTasks = task.blockedBy.filter(id =>
      unresolvedTaskIds.has(id),
    )
    if (blockedByTasks.length > 0) {
      return { success: false, reason: 'blocked', task, blockedByTasks }
    }

    // Claim the task (already holding taskPath lock — use unsafe variant)
    const updated = await updateTaskUnsafe(taskListId, taskId, {
      owner: claimantAgentId,
    })
    return { success: true, task: updated! }
  } catch (error) {
    logForDebugging(
      `[Tasks] Failed to claim task ${taskId}: ${errorMessage(error)}`,
    )
    logError(error)
    return { success: false, reason: 'task_not_found' }
  } finally {
    if (release) {
      await release()
    }
  }
}

/**
 * Claims a task with an atomic check for agent busy status.
 * Uses a task-list-level lock to ensure the busy check and claim are atomic.
 */
async function claimTaskWithBusyCheck(
  taskListId: string,
  taskId: string,
  claimantAgentId: string,
): Promise<ClaimTaskResult> {
  const lockPath = await ensureTaskListLockFile(taskListId)

  let release: (() => Promise<void>) | undefined
  try {
    // Acquire exclusive lock on the task list
    release = await lockfile.lock(lockPath, LOCK_OPTIONS)

    // Read all tasks to check agent status and task state atomically
    const allTasks = await listTasks(taskListId)

    // Find the task we want to claim
    const task = allTasks.find(t => t.id === taskId)
    if (!task) {
      return { success: false, reason: 'task_not_found' }
    }

    // Check if already claimed by another agent
    if (task.owner && task.owner !== claimantAgentId) {
      return { success: false, reason: 'already_claimed', task }
    }

    // Check if already resolved
    if (task.status === 'completed') {
      return { success: false, reason: 'already_resolved', task }
    }

    // Check for unresolved blockers (open or in_progress tasks block)
    const unresolvedTaskIds = new Set(
      allTasks.filter(t => t.status !== 'completed').map(t => t.id),
    )
    const blockedByTasks = task.blockedBy.filter(id =>
      unresolvedTaskIds.has(id),
    )
    if (blockedByTasks.length > 0) {
      return { success: false, reason: 'blocked', task, blockedByTasks }
    }

    // Check if agent is busy with other unresolved tasks
    const agentOpenTasks = allTasks.filter(
      t =>
        t.status !== 'completed' &&
        t.owner === claimantAgentId &&
        t.id !== taskId,
    )
    if (agentOpenTasks.length > 0) {
      return {
        success: false,
        reason: 'agent_busy',
        task,
        busyWithTasks: agentOpenTasks.map(t => t.id),
      }
    }

    // Claim the task
    const updated = await updateTask(taskListId, taskId, {
      owner: claimantAgentId,
    })
    return { success: true, task: updated! }
  } catch (error) {
    logForDebugging(
      `[Tasks] Failed to claim task ${taskId} with busy check: ${errorMessage(error)}`,
    )
    logError(error)
    return { success: false, reason: 'task_not_found' }
  } finally {
    if (release) {
      await release()
    }
  }
}

/**
 * Team member info (subset of TeamFile member structure)
 */
export type TeamMember = {
  agentId: string
  name: string
  agentType?: string
}

/**
 * Agent status based on task ownership
 */
export type AgentStatus = {
  agentId: string
  name: string
  agentType?: string
  status: 'idle' | 'busy'
  currentTasks: string[] // task IDs the agent owns
}

/**
 * Sanitizes a name for use in file paths
 */
function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
}

/**
 * Reads team members from the team file
 */
async function readTeamMembers(
  teamName: string,
): Promise<{ leadAgentId: string; members: TeamMember[] } | null> {
  const teamsDir = getTeamsDir()
  const teamFilePath = join(teamsDir, sanitizeName(teamName), 'config.json')
  try {
    const content = await readFile(teamFilePath, 'utf-8')
    const teamFile = jsonParse(content) as {
      leadAgentId: string
      members: TeamMember[]
    }
    return {
      leadAgentId: teamFile.leadAgentId,
      members: teamFile.members.map(m => ({
        agentId: m.agentId,
        name: m.name,
        agentType: m.agentType,
      })),
    }
  } catch (e) {
    const code = getErrnoCode(e)
    if (code === 'ENOENT') {
      return null
    }
    logForDebugging(
      `[Tasks] Failed to read team file for ${teamName}: ${errorMessage(e)}`,
    )
    return null
  }
}

/**
 * Gets the status of all agents in a team based on task ownership.
 * An agent is considered "idle" if they don't own any open tasks.
 * An agent is considered "busy" if they own at least one open task.
 *
 * @param teamName - The name of the team (also used as taskListId)
 * @returns Array of agent statuses, or null if team not found
 */
export async function getAgentStatuses(
  teamName: string,
): Promise<AgentStatus[] | null> {
  const teamData = await readTeamMembers(teamName)
  if (!teamData) {
    return null
  }

  const taskListId = sanitizeName(teamName)
  const allTasks = await listTasks(taskListId)

  // Get unresolved tasks grouped by owner (open or in_progress)
  const unresolvedTasksByOwner = new Map<string, string[]>()
  for (const task of allTasks) {
    if (task.status !== 'completed' && task.owner) {
      const existing = unresolvedTasksByOwner.get(task.owner) || []
      existing.push(task.id)
      unresolvedTasksByOwner.set(task.owner, existing)
    }
  }

  // Build status for each agent (leader is already in members)
  return teamData.members.map(member => {
    // Check both name (new) and agentId (legacy) for backwards compatibility
    const tasksByName = unresolvedTasksByOwner.get(member.name) || []
    const tasksById = unresolvedTasksByOwner.get(member.agentId) || []
    const currentTasks = uniq([...tasksByName, ...tasksById])
    return {
      agentId: member.agentId,
      name: member.name,
      agentType: member.agentType,
      status: currentTasks.length === 0 ? 'idle' : 'busy',
      currentTasks,
    }
  })
}

/**
 * Result of unassigning tasks from a teammate
 */
export type UnassignTasksResult = {
  unassignedTasks: Array<{ id: string; subject: string }>
  notificationMessage: string
}

/**
 * Unassigns all open tasks from a teammate and builds a notification message.
 * Used when a teammate is killed or gracefully shuts down.
 *
 * @param teamName - The team/task list name
 * @param teammateId - The teammate's agent ID
 * @param teammateName - The teammate's display name
 * @param reason - How the teammate exited ('terminated' | 'shutdown')
 * @returns The unassigned tasks and a formatted notification message
 */
export async function unassignTeammateTasks(
  teamName: string,
  teammateId: string,
  teammateName: string,
  reason: 'terminated' | 'shutdown',
): Promise<UnassignTasksResult> {
  const tasks = await listTasks(teamName)
  const unresolvedAssignedTasks = tasks.filter(
    t =>
      t.status !== 'completed' &&
      (t.owner === teammateId || t.owner === teammateName),
  )

  // Unassign each task and reset status to open
  for (const task of unresolvedAssignedTasks) {
    await updateTask(teamName, task.id, { owner: undefined, status: 'pending' })
  }

  if (unresolvedAssignedTasks.length > 0) {
    logForDebugging(
      `[Tasks] Unassigned ${unresolvedAssignedTasks.length} task(s) from ${teammateName}`,
    )
  }

  // Build notification message
  const actionVerb =
    reason === 'terminated' ? 'was terminated' : 'has shut down'
  let notificationMessage = `${teammateName} ${actionVerb}.`
  if (unresolvedAssignedTasks.length > 0) {
    const taskList = unresolvedAssignedTasks
      .map(t => `#${t.id} "${t.subject}"`)
      .join(', ')
    notificationMessage += ` ${unresolvedAssignedTasks.length} task(s) were unassigned: ${taskList}. Use TaskList to check availability and TaskUpdate with owner to reassign them to idle teammates.`
  }

  return {
    unassignedTasks: unresolvedAssignedTasks.map(t => ({
      id: t.id,
      subject: t.subject,
    })),
    notificationMessage,
  }
}

export const DEFAULT_TASKS_MODE_TASK_LIST_ID = 'tasklist'
