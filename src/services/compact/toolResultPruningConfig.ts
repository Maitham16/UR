import { getInitialSettings } from '../../utils/settings/settings.js'

/**
 * Size-triggered tool-result pruning.
 *
 * Read from settings rather than GrowthBook. The existing time-based config
 * (`tengu_slate_heron`) defaults to `enabled: false` and is only ever flipped
 * by a GrowthBook flag, which a local UR install never reaches — so that
 * trigger is permanently off for every real user. A feature nobody can turn on
 * is not a feature, and this one is meant to run.
 */
export type ToolResultPruningConfig = {
  enabled: boolean
  /**
   * Only prune when it frees at least this many tokens. Clearing invalidates
   * the cached prefix, so a small cleanup costs more in cache misses than it
   * reclaims. 20k is the threshold the field settled on for that trade.
   */
  minTokensFreed: number
  /**
   * Protected zone: the most recent N compactable tool results are never
   * cleared, so the model keeps the working set it is actually reasoning about.
   */
  keepRecent: number
}

export const TOOL_RESULT_PRUNING_DEFAULTS: ToolResultPruningConfig = {
  // On by default. The alternative when context fills is autocompact, which
  // replaces the whole history with a summary — strictly more destructive than
  // dropping superseded file reads. The threshold keeps short sessions
  // untouched, so this only acts where it helps.
  enabled: true,
  minTokensFreed: 20_000,
  keepRecent: 8,
}

export function getToolResultPruningConfig(): ToolResultPruningConfig {
  const configured = (
    getInitialSettings() as {
      context?: { pruneToolResults?: Partial<ToolResultPruningConfig> }
    } | null
  )?.context?.pruneToolResults
  if (!configured) return TOOL_RESULT_PRUNING_DEFAULTS

  // Each field is validated independently: a user who sets only keepRecent
  // should not lose the other defaults, and a nonsense value should fall back
  // rather than disable pruning or clear everything.
  return {
    enabled:
      typeof configured.enabled === 'boolean'
        ? configured.enabled
        : TOOL_RESULT_PRUNING_DEFAULTS.enabled,
    minTokensFreed:
      typeof configured.minTokensFreed === 'number' &&
      Number.isFinite(configured.minTokensFreed) &&
      configured.minTokensFreed >= 0
        ? configured.minTokensFreed
        : TOOL_RESULT_PRUNING_DEFAULTS.minTokensFreed,
    keepRecent:
      typeof configured.keepRecent === 'number' &&
      Number.isInteger(configured.keepRecent) &&
      configured.keepRecent >= 1
        ? configured.keepRecent
        : TOOL_RESULT_PRUNING_DEFAULTS.keepRecent,
  }
}
