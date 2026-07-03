// Reads background tasks through the existing `ur bg list --json` surface
// (`{ tasks: BackgroundTask[] }` — see services/agents/backgroundRunner.ts).
// Read-only: this PR does not add start/cancel actions for background tasks.

import type { BackgroundTaskSummary, BackgroundTaskStatus } from '../bridge/types.js'
import { runUrCliCapture } from '../bridge/urCli.js'

const VALID_STATUSES: readonly BackgroundTaskStatus[] = ['queued', 'running', 'completed', 'failed', 'canceled']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function parseBackgroundListJson(raw: string): BackgroundTaskSummary[] {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  if (!isRecord(data) || !Array.isArray(data.tasks)) return []
  const summaries: BackgroundTaskSummary[] = []
  for (const entry of data.tasks) {
    if (!isRecord(entry)) continue
    if (typeof entry.id !== 'string' || typeof entry.task !== 'string') continue
    const status = VALID_STATUSES.includes(entry.status as BackgroundTaskStatus)
      ? (entry.status as BackgroundTaskStatus)
      : 'queued'
    summaries.push({
      id: entry.id,
      task: entry.task,
      status,
      logFile: typeof entry.logFile === 'string' ? entry.logFile : '',
    })
  }
  return summaries
}

/** Never throws — a missing `ur bg` surface (or nothing background running
 * yet) just means an empty list for the actions panel, not a broken view. */
export async function loadBackgroundTasks(cwd: string): Promise<BackgroundTaskSummary[]> {
  try {
    const { stdout } = await runUrCliCapture(['bg', 'list', '--json'], { cwd })
    return parseBackgroundListJson(stdout)
  } catch {
    return []
  }
}
