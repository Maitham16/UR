export function escapeHtml(text: unknown): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

export function formatRelativeTime(value?: string): string {
  if (!value) return 'unknown time'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const deltaMs = Date.now() - date.getTime()
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (deltaMs < minute) return 'just now'
  if (deltaMs < hour) return `${Math.max(1, Math.floor(deltaMs / minute))}m ago`
  if (deltaMs < day) return `${Math.floor(deltaMs / hour)}h ago`
  if (deltaMs < 7 * day) return `${Math.floor(deltaMs / day)}d ago`
  return date.toLocaleDateString()
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Prefers a child process error's stderr (where git/CLI failures put their
 * real message) over the generic "exited with code N" wrapper message. */
export function processErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'stderr' in error) {
    const stderr = (error as { stderr?: unknown }).stderr
    if (typeof stderr === 'string' && stderr.trim()) return stderr.trim()
  }
  return errorMessage(error)
}
