import type { Task } from '../../utils/tasks.js'
import { truncateToWidth } from '../../utils/truncate.js'

/** Select the one task that is actively executing, never a failed/stale row. */
export function currentSpinnerTaskLabel(
  tasks: readonly Task[] | undefined,
): string | null {
  const task = tasks?.find(candidate => candidate.status === 'in_progress')
  const label = (task?.activeForm || task?.subject || '')
    .replace(/\s+/g, ' ')
    .trim()
  return label || null
}

/** Keep the task on the activity row only when it can remain readable. */
export function fitSpinnerTaskLabel(
  label: string | null | undefined,
  maxWidth: number,
): string | null {
  if (!label || maxWidth < 8) return null
  return truncateToWidth(label, Math.min(48, maxWidth))
}
