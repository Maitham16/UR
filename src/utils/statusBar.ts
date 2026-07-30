import { isBackgroundTask, type TaskState } from '../tasks/types.js'
import { isUpdateAvailable } from './updateNotice.js'

export type StatusBarInput = {
  version: string
  providerLabel?: string | null
  authMode?: string | null
  model?: string | null
  mode?: string | null
  branch?: string | null
  taskRunningCount?: number
  taskTotalCount?: number
  agentRunningCount?: number
  checksStatus?: string | null
  latestVersion?: string | null
  isCheckingUpdate?: boolean
}

export type StatusBarDisplayInput = {
  settingsStatusLineConfigured?: boolean
  isKairosActive?: boolean
  isTTY?: boolean
  isCI?: boolean
  term?: string
  disabled?: boolean
}

/**
 * Count only work that is both active and actually backgrounded.
 *
 * The task store intentionally retains foreground and recently-finished
 * entries. Counting the whole store made the status line show stale ratios
 * such as "tasks: 0/4 active" long after the work had ended.
 */
export function countActiveBackgroundTasks(
  tasks: Iterable<TaskState>,
): number {
  let active = 0
  for (const task of tasks) {
    if (isBackgroundTask(task)) active += 1
  }
  return active
}

/**
 * Count agents running in the foreground of the current turn.
 *
 * isBackgroundTask() excludes these on purpose, so subagents dispatched during
 * a turn were counted nowhere and the status line stayed silent while they ran
 * — the one moment the user most wants to know how many are working. Counted
 * separately rather than folded into the background total: they are different
 * kinds of work, and merging them would resurrect the stale-ratio problem the
 * background counter was narrowed to fix.
 *
 * Only 'running' counts. A pending foreground agent has not started, and
 * reporting it as working would be the kind of optimistic number that makes a
 * status line untrustworthy.
 */
export function countActiveForegroundAgents(
  tasks: Iterable<TaskState>,
): number {
  let active = 0
  for (const task of tasks) {
    if (task.status !== 'running') continue
    if (!('isBackgrounded' in task) || task.isBackgrounded !== false) continue
    if (!String(task.type ?? '').includes('agent')) continue
    active += 1
  }
  return active
}

export function statusBarShouldDisplay({
  settingsStatusLineConfigured,
  isKairosActive,
  isTTY,
  isCI,
  term,
  disabled,
}: StatusBarDisplayInput): boolean {
  if (isKairosActive || disabled) {
    return false
  }
  if (settingsStatusLineConfigured) {
    return true
  }
  if (isCI || isTTY === false || term === 'dumb') {
    return false
  }
  return true
}

export function buildDefaultStatusBar({
  version,
  providerLabel,
  model,
  mode,
  branch,
  taskRunningCount = 0,
  taskTotalCount = 0,
  agentRunningCount = 0,
  checksStatus,
  latestVersion,
  isCheckingUpdate,
}: StatusBarInput): string {
  const parts: string[] = []

  // Put the live model and active work first. The status line truncates at
  // terminal width, so provider/branch metadata must not hide the state users
  // most need while a request is running.
  if (model) {
    parts.push(model)
  }
  // Foreground agents first: they are the work happening right now, and the
  // status line truncates at terminal width.
  if (agentRunningCount > 0) {
    parts.push(
      `agents: ${agentRunningCount} running`,
    )
  }
  if (taskRunningCount > 0) {
    parts.push(
      taskTotalCount > taskRunningCount
        ? `tasks: ${taskRunningCount}/${taskTotalCount} active`
        : `tasks: ${taskRunningCount} active`,
    )
  }
  if (providerLabel) {
    parts.push(providerLabel)
  }
  if (mode) {
    parts.push(mode)
  }
  if (branch && branch !== 'HEAD') {
    parts.push(branch)
  }

  if (checksStatus) {
    parts.push(checksStatus)
  }

  if (isCheckingUpdate) {
    parts.push('update checking')
  } else if (isUpdateAvailable(version, latestVersion)) {
    parts.push(`update ${latestVersion} available`)
  }

  return parts.length > 0 ? parts.join(' | ') : 'ready'
}
