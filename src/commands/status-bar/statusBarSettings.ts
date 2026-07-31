/**
 * Persistence for status bar field visibility.
 *
 * Kept separate from the command component so the read/write round trip is
 * testable without rendering Ink.
 */

import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'
import {
  resolveStatusBarFieldVisibility,
  STATUS_BAR_FIELDS,
  type StatusBarFieldId,
} from '../../utils/statusBarFields.js'

const SOURCE = 'userSettings' as const

export function readStatusBarFieldVisibility(): Record<StatusBarFieldId, boolean> {
  const settings = getSettingsForSource(SOURCE)
  return resolveStatusBarFieldVisibility(
    (settings as { statusBarFields?: Record<string, unknown> } | null)?.statusBarFields,
  )
}

/**
 * Persist the chosen ids. Every known field is written explicitly — storing
 * only the enabled ones would make a later change to a field's default
 * silently flip a choice the user had already made.
 */
export function writeStatusBarFieldVisibility(
  visibleIds: readonly StatusBarFieldId[],
): { ok: boolean; message: string } {
  const chosen = new Set(visibleIds)
  const statusBarFields: Record<string, boolean> = {}
  for (const field of STATUS_BAR_FIELDS) {
    statusBarFields[field.id] = chosen.has(field.id)
  }
  const current = getSettingsForSource(SOURCE) ?? {}
  const { error } = updateSettingsForSource(SOURCE, {
    ...current,
    statusBarFields,
  })
  if (error) {
    return { ok: false, message: error.message }
  }
  return { ok: true, message: describeStatusBarSelection(visibleIds) }
}

/** Human summary of what is on, for the command's completion message. */
export function describeStatusBarSelection(
  visibleIds: readonly StatusBarFieldId[],
): string {
  if (visibleIds.length === 0) {
    return 'Status bar fields: none (the bar will show "ready").'
  }
  const labels = STATUS_BAR_FIELDS.filter(field => visibleIds.includes(field.id)).map(
    field => field.label,
  )
  return `Status bar fields: ${labels.join(', ')}.`
}
