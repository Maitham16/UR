import {
  EFFORT_HIGH,
  EFFORT_LOW,
  EFFORT_MAX,
  EFFORT_MEDIUM,
} from '../constants/figures.js'
import {
  type EffortLevel,
  type EffortValue,
  getDisplayedEffortLevel,
  modelSupportsEffort,
} from '../utils/effort.js'
import { getActiveProviderSettings, type ProviderId } from '../services/providers/providerRegistry.js'
import { configuredThinkingBudget } from '../services/providers/thinkingBudget.js'
import { getRuntimeProvider } from '../utils/model/providers.js'

/**
 * Build the text for the effort-changed notification, e.g. "◐ medium · /effort".
 * Returns undefined if the model doesn't support effort.
 */
export function getEffortNotificationText(
  effortValue: EffortValue | undefined,
  model: string,
  provider?: ProviderId,
): string | undefined {
  if (!modelSupportsEffort(model, provider) || configuredThinkingBudget(provider ?? getRuntimeProvider(), model, getActiveProviderSettings()) !== undefined) return undefined
  const level = getDisplayedEffortLevel(model, effortValue, provider)
  return `${effortLevelToSymbol(level)} ${level} · /effort`
}

export function effortLevelToSymbol(level: EffortLevel): string {
  switch (level) {
    case 'none':
      return '○'
    case 'minimal':
    case 'low':
      return EFFORT_LOW
    case 'medium':
      return EFFORT_MEDIUM
    case 'high':
      return EFFORT_HIGH
    case 'xhigh':
    case 'max':
    case 'ultra':
      return EFFORT_MAX
    default:
      // Provider-defined names carry no inferred relative strength.
      return '◇'
  }
}
