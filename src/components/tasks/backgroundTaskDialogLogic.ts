export type BackgroundTaskListIdentity = {
  id: string
}

export type BackgroundTaskDialogIdentity = BackgroundTaskListIdentity & {
  type: string
}

/**
 * Keep list rendering and the initial auto-open decision on identical
 * visibility rules.
 */
export function isBackgroundTaskVisibleInDialog(
  task: BackgroundTaskDialogIdentity,
  foregroundedTaskId: string | undefined,
  showSpinnerTree: boolean,
): boolean {
  if (task.type === 'local_agent' && task.id === foregroundedTaskId) {
    return false
  }
  if (showSpinnerTree && task.type === 'in_process_teammate') {
    return false
  }
  return true
}

export function isActiveBackgroundTaskStatus(status: string): boolean {
  return status === 'running' || status === 'pending'
}

export function countActiveTeammates(
  items: readonly { type: string; status: string }[],
): number {
  return items.filter(
    item =>
      item.type === 'in_process_teammate' &&
      isActiveBackgroundTaskStatus(item.status),
  ).length
}

/**
 * Resolve selection by identity, not by a mutable array position.
 *
 * Background tasks are sorted newest-first, so a newly-started task can be
 * inserted before the current row. Keeping only an index could make Enter or
 * x target a different task than the one the user selected.
 */
export function resolveBackgroundTaskSelection(
  items: readonly BackgroundTaskListIdentity[],
  selectedItemId: string | null,
): number {
  if (items.length === 0) return -1
  if (selectedItemId) {
    const selectedIndex = items.findIndex(item => item.id === selectedItemId)
    if (selectedIndex >= 0) return selectedIndex
  }
  return 0
}

/**
 * Leave room for the dialog frame, pointer, and task status on narrow
 * terminals without forcing the old 30-column minimum to wrap.
 */
export function getBackgroundTaskActivityWidth(columns: number): number {
  return Math.max(8, columns - 26)
}
