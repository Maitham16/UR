export type ActivityRowVisibility = {
  toolAllowsActivity: boolean
  hasBlockingPrompt: boolean
  hasActiveWork: boolean
  pendingWorkerRequest: boolean
  onlySleepToolActive: boolean
}

/**
 * The activity row reflects turn liveness, independent of which response
 * surfaces happen to be visible. In particular, streamed assistant text must
 * never replace the persistent `◭ Mashoofing…` status.
 */
export function shouldShowActivityRow({
  toolAllowsActivity,
  hasBlockingPrompt,
  hasActiveWork,
  pendingWorkerRequest,
  onlySleepToolActive,
}: ActivityRowVisibility): boolean {
  return (
    toolAllowsActivity &&
    !hasBlockingPrompt &&
    hasActiveWork &&
    !pendingWorkerRequest &&
    !onlySleepToolActive
  )
}
