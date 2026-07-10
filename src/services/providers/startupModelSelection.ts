import type { SettingsJson } from '../../utils/settings/types.js'

export type StartupModelSelectionContext = {
  explicitModels?: Array<string | null | undefined>
  workspaceSettings?: Array<SettingsJson | null | undefined>
  isResume?: boolean
  skipsModelExecution?: boolean
}

function isNonEmptyModel(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function settingsSelectModel(
  settings: SettingsJson | null | undefined,
): boolean {
  return (
    isNonEmptyModel(settings?.provider?.model) ||
    isNonEmptyModel(settings?.model)
  )
}

/**
 * A new workspace must make a deliberate model choice. User-global settings
 * are intentionally not accepted here because they must not silently decide
 * the model for a folder that has never selected one.
 */
export function shouldRequireStartupModelSelection(
  context: StartupModelSelectionContext,
): boolean {
  if (context.isResume || context.skipsModelExecution) return false
  if (context.explicitModels?.some(isNonEmptyModel)) return false
  if (context.workspaceSettings?.some(settingsSelectModel)) return false
  return true
}

