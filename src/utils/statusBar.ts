import { isUpdateAvailable } from './updateNotice.js'

export type StatusBarInput = {
  version: string
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
  model,
  mode,
  branch,
  taskRunningCount = 0,
  taskTotalCount = 0,
  checksStatus,
  latestVersion,
  isCheckingUpdate,
}: StatusBarInput): string {
  const parts = [`UR-AGENT v${version}`]

  if (model) {
    parts.push(`model: ${model}`)
  }
  if (mode) {
    parts.push(`mode: ${mode}`)
  }
  if (branch && branch !== 'HEAD') {
    parts.push(`branch: ${branch}`)
  }

  if (taskTotalCount > 0) {
    parts.push(`tasks: ${taskRunningCount}/${taskTotalCount} running`)
  } else {
    parts.push('tasks: idle')
  }

  if (checksStatus) {
    parts.push(`checks: ${checksStatus}`)
  }

  if (isCheckingUpdate) {
    parts.push('Update: checking')
  } else if (isUpdateAvailable(version, latestVersion)) {
    parts.push(`Update: ${version} -> ${latestVersion} available`)
  }

  return parts.join(' | ')
}
