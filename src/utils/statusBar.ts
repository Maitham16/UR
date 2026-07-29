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
  if (taskTotalCount > 0) {
    parts.push(`tasks: ${taskRunningCount}/${taskTotalCount} active`)
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
