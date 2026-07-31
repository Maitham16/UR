/**
 * Status bar field model.
 *
 * The bar previously composed a fixed sequence of parts with no way to turn
 * any of them off, no width awareness (the terminal truncated whatever did not
 * fit, so the rightmost fields simply vanished with no indication), and no
 * notion of which fields matter most when space is short.
 *
 * Fields are declared here with a stable id, a default visibility and a
 * priority. Composition drops the lowest-priority fields first so the bar
 * degrades predictably instead of being cut mid-word.
 */

export type StatusBarFieldId =
  | 'state'
  | 'task'
  | 'taskCounts'
  | 'agents'
  | 'provider'
  | 'model'
  | 'tool'
  | 'tokens'
  | 'runtime'
  | 'context'
  | 'mode'
  | 'branch'
  | 'update'
  | 'attention'

export type StatusBarFieldSpec = {
  id: StatusBarFieldId
  /** Shown in the settings picker. */
  label: string
  /** One-line explanation shown under the label. */
  description: string
  /** Whether the field is on when the user has not chosen. */
  defaultVisible: boolean
  /**
   * Lower drops first when the bar does not fit. `attention` outranks
   * everything because a bar that hides an error is worse than a short one.
   */
  priority: number
}

export const STATUS_BAR_FIELDS: readonly StatusBarFieldSpec[] = [
  {
    id: 'attention',
    label: 'Errors / attention',
    description: 'Failures and anything needing a decision',
    defaultVisible: true,
    priority: 100,
  },
  {
    id: 'state',
    label: 'Current state',
    description: 'Idle, working, waiting for input',
    defaultVisible: true,
    priority: 90,
  },
  {
    id: 'model',
    label: 'Model',
    description: 'Active model name',
    defaultVisible: true,
    priority: 85,
  },
  {
    id: 'task',
    label: 'Active task',
    description: 'The task currently running',
    defaultVisible: true,
    priority: 80,
  },
  {
    id: 'taskCounts',
    label: 'Task progress',
    description: 'Completed out of total',
    defaultVisible: true,
    priority: 75,
  },
  {
    id: 'agents',
    label: 'Active agents',
    description: 'Number of subagents running',
    defaultVisible: true,
    priority: 70,
  },
  {
    id: 'tool',
    label: 'Tool activity',
    description: 'Tool currently executing',
    defaultVisible: true,
    priority: 65,
  },
  {
    id: 'context',
    label: 'Context usage',
    description: 'Percentage of the context window in use',
    defaultVisible: true,
    priority: 60,
  },
  {
    id: 'tokens',
    label: 'Token usage',
    description: 'Session tokens, when the provider reports them',
    defaultVisible: false,
    priority: 55,
  },
  {
    id: 'runtime',
    label: 'Runtime',
    description: 'Elapsed time for the current run',
    defaultVisible: false,
    priority: 50,
  },
  {
    id: 'provider',
    label: 'Provider',
    description: 'Active provider name',
    defaultVisible: true,
    priority: 45,
  },
  {
    id: 'mode',
    label: 'Permission mode',
    description: 'Current permission mode',
    defaultVisible: true,
    priority: 40,
  },
  {
    id: 'branch',
    label: 'Git branch',
    description: 'Checked-out branch',
    defaultVisible: true,
    priority: 35,
  },
  {
    id: 'update',
    label: 'Update available',
    description: 'Shown only when a newer version exists',
    defaultVisible: true,
    priority: 30,
  },
]

const FIELD_BY_ID = new Map(STATUS_BAR_FIELDS.map(field => [field.id, field]))

export function isStatusBarFieldId(value: unknown): value is StatusBarFieldId {
  return typeof value === 'string' && FIELD_BY_ID.has(value as StatusBarFieldId)
}

export function statusBarFieldSpec(id: StatusBarFieldId): StatusBarFieldSpec {
  return FIELD_BY_ID.get(id)!
}

/** The default visibility map, used when the user has saved nothing. */
export function defaultStatusBarFieldVisibility(): Record<StatusBarFieldId, boolean> {
  const out = {} as Record<StatusBarFieldId, boolean>
  for (const field of STATUS_BAR_FIELDS) {
    out[field.id] = field.defaultVisible
  }
  return out
}

/**
 * Merge a saved preference map over the defaults, ignoring unknown ids so a
 * settings file written by a newer or older build cannot break the bar.
 */
export function resolveStatusBarFieldVisibility(
  saved: Record<string, unknown> | undefined | null,
): Record<StatusBarFieldId, boolean> {
  const resolved = defaultStatusBarFieldVisibility()
  if (!saved || typeof saved !== 'object') {
    return resolved
  }
  for (const [key, value] of Object.entries(saved)) {
    if (isStatusBarFieldId(key) && typeof value === 'boolean') {
      resolved[key] = value
    }
  }
  return resolved
}

/** Ids currently visible, in display order. */
export function visibleStatusBarFieldIds(
  visibility: Record<StatusBarFieldId, boolean>,
): StatusBarFieldId[] {
  return STATUS_BAR_FIELDS.filter(field => visibility[field.id]).map(field => field.id)
}
