// Reads and manages background tasks through the existing `ur bg` CLI surface.
// Every invocation uses an explicit argv array; user prompts and task ids are
// never interpolated into a shell command.

import type { BackgroundTaskSummary, BackgroundTaskStatus } from '../bridge/types.js'
import { runUrCliCapture } from '../bridge/urCli.js'

const VALID_STATUSES: readonly BackgroundTaskStatus[] = ['queued', 'running', 'completed', 'failed', 'canceled']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function tryParseBackgroundListJson(raw: string): BackgroundTaskSummary[] | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(data) || !Array.isArray(data.tasks)) return null
  const summaries: BackgroundTaskSummary[] = []
  for (const entry of data.tasks) {
    if (!isRecord(entry)) continue
    if (typeof entry.id !== 'string' || typeof entry.task !== 'string') continue
    if (!VALID_STATUSES.includes(entry.status as BackgroundTaskStatus)) continue
    const status = entry.status as BackgroundTaskStatus
    summaries.push({
      id: entry.id,
      task: entry.task,
      status,
      logFile: typeof entry.logFile === 'string' ? entry.logFile : '',
    })
  }
  return summaries
}

export function parseBackgroundListJson(raw: string): BackgroundTaskSummary[] {
  return tryParseBackgroundListJson(raw) ?? []
}

export type BackgroundRunOptions = {
  worktree: boolean
  offline: boolean
}

export function buildBackgroundRunArgs(
  task: string,
  options: BackgroundRunOptions,
): string[] {
  const normalized = task.trim()
  if (!normalized || normalized.length > 64_000 || normalized.includes('\0')) {
    throw new Error('Background task must contain 1 to 64,000 characters and no NUL bytes.')
  }
  return [
    'bg',
    'run',
    normalized,
    ...(options.worktree ? ['--worktree'] : []),
    ...(options.offline ? ['--offline'] : []),
    '--json',
  ]
}

export function buildBackgroundCancelArgs(id: string): string[] {
  if (!id || id.length > 256 || id.includes('\0')) {
    throw new Error('Background task id is invalid.')
  }
  return ['bg', 'kill', id]
}

export async function loadBackgroundTasks(cwd: string): Promise<BackgroundTaskSummary[]> {
  const { stdout, stderr, exitCode } = await runUrCliCapture(
    ['bg', 'list', '--json'],
    { cwd },
  )
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `ur bg list exited with status ${exitCode}`)
  }
  const tasks = tryParseBackgroundListJson(stdout)
  if (!tasks) throw new Error('ur bg list returned invalid JSON')
  return tasks
}
