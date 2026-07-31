import {
  resolveStatusBarFieldVisibility,
  STATUS_BAR_FIELDS,
  type StatusBarFieldId,
} from './statusBarFields.js'
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
  /** Idle / working / waiting. */
  state?: string | null
  /** Description of the task currently running. */
  activeTask?: string | null
  /** Tasks finished so far in the current list. */
  taskCompletedCount?: number
  /** Subagents currently executing. */
  activeAgentCount?: number
  /** Tool currently executing. */
  activeTool?: string | null
  /** Session token total; omitted entirely when the provider reported none. */
  totalTokens?: number | null
  /** Elapsed run time in ms. */
  runtimeMs?: number | null
  /** Percentage of the context window in use, 0-100. */
  contextPercent?: number | null
  /** Error or anything needing the user's attention. */
  attention?: string | null
  /** Saved per-field visibility; defaults are used when absent. */
  fieldVisibility?: Record<string, unknown> | null
  /** Terminal width. When given, the bar is fitted rather than truncated. */
  columns?: number | null
}

const SEPARATOR = ' | '

function formatRuntime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return `${minutes}m ${seconds}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function formatTokens(total: number): string {
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M tok`
  if (total >= 1_000) return `${(total / 1_000).toFixed(1)}K tok`
  return `${total} tok`
}

/** Clip a value so one long name cannot consume the whole bar. */
function clip(value: string, max: number): string {
  if (max <= 1 || value.length <= max) return value
  return `${value.slice(0, Math.max(1, max - 1))}…`
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

/**
 * Compose one field's rendered text, or null when it has nothing to say.
 * A field with no data is omitted rather than rendered as an empty or zero
 * value — an empty slot is clutter, and a zero is a claim we cannot support.
 */
function renderField(id: StatusBarFieldId, input: StatusBarInput): string | null {
  switch (id) {
    case 'attention':
      return input.attention ? clip(input.attention, 60) : null
    case 'state':
      return input.state ? input.state : null
    case 'model':
      return input.model ? clip(input.model, 40) : null
    case 'task':
      return input.activeTask ? clip(input.activeTask, 40) : null
    case 'taskCounts': {
      const total = input.taskTotalCount ?? 0
      if (total <= 0) return null
      const done = input.taskCompletedCount ?? 0
      const running = input.taskRunningCount ?? 0
      // Completed/total is the progress users ask for; the running count is
      // only added when it tells them something the ratio does not.
      return running > 0 ? `${done}/${total} done · ${running} running` : `${done}/${total} done`
    }
    case 'agents': {
      const count = input.activeAgentCount ?? 0
      if (count <= 0) return null
      return count === 1 ? '1 agent' : `${count} agents`
    }
    case 'tool':
      return input.activeTool ? clip(input.activeTool, 30) : null
    case 'context': {
      const percent = input.contextPercent
      if (typeof percent !== 'number' || !Number.isFinite(percent) || percent <= 0) {
        return null
      }
      return `ctx ${Math.min(100, Math.round(percent))}%`
    }
    case 'tokens': {
      const total = input.totalTokens
      // Never render a fabricated or zero total — see the usage accounting rule.
      if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) {
        return null
      }
      return formatTokens(total)
    }
    case 'runtime': {
      const ms = input.runtimeMs
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null
      return formatRuntime(ms)
    }
    case 'provider':
      return input.providerLabel ? clip(input.providerLabel, 24) : null
    case 'mode':
      return input.mode ? input.mode : null
    case 'branch':
      return input.branch && input.branch !== 'HEAD' ? clip(input.branch, 24) : null
    case 'update':
      if (input.isCheckingUpdate) return 'update checking'
      return isUpdateAvailable(input.version, input.latestVersion)
        ? `update ${input.latestVersion} available`
        : null
    default:
      return null
  }
}

export function buildDefaultStatusBar(input: StatusBarInput): string {
  const visibility = resolveStatusBarFieldVisibility(input.fieldVisibility)

  const rendered: Array<{ id: StatusBarFieldId; text: string; priority: number }> = []
  const seen = new Set<string>()
  for (const field of STATUS_BAR_FIELDS) {
    if (!visibility[field.id]) continue
    const text = renderField(field.id, input)
    if (!text) continue
    // Two fields resolving to the same string would read as duplicated state.
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    rendered.push({ id: field.id, text, priority: field.priority })
  }

  // checksStatus is an existing caller-supplied string with no field of its
  // own; it is appended last so behaviour for callers that set it is kept.
  if (input.checksStatus && !seen.has(input.checksStatus.toLowerCase())) {
    rendered.push({ id: 'attention', text: input.checksStatus, priority: 20 })
  }

  if (rendered.length === 0) {
    return 'ready'
  }

  const columns = input.columns
  if (typeof columns !== 'number' || !Number.isFinite(columns) || columns <= 0) {
    return rendered.map(part => part.text).join(SEPARATOR)
  }

  // Drop the lowest-priority fields until the bar fits, so the terminal never
  // has to cut one mid-word and silently lose the fields to its right.
  const kept = [...rendered]
  const width = (parts: typeof kept): number =>
    parts.reduce((sum, part) => sum + part.text.length, 0) +
    Math.max(0, parts.length - 1) * SEPARATOR.length

  while (kept.length > 1 && width(kept) > columns) {
    let lowestIndex = 0
    for (let i = 1; i < kept.length; i++) {
      if (kept[i]!.priority < kept[lowestIndex]!.priority) {
        lowestIndex = i
      }
    }
    kept.splice(lowestIndex, 1)
  }

  const line = kept.map(part => part.text).join(SEPARATOR)
  return line.length > columns ? clip(line, columns) : line
}
