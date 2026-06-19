import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import {
  isMaxSubscriber,
  isProSubscriber,
  isTeamPremiumSubscriber,
} from '../utils/auth.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { getAPIProvider } from '../utils/model/providers.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../utils/settings/settings.js'

/**
 * Migrate Pro/Max/Team Premium first-party users off explicit modelS 4.5
 * model strings to the 'modelS' alias (which now resolves to modelS 4.6).
 *
 * Users may have been pinned to explicit modelS 4.5 strings by:
 * - The earlier migratemodelS1mTomodelS45 migration (modelS[1m] → explicit 4.5[1m])
 * - Manually selecting it via /model
 *
 * Reads userSettings specifically (not merged) so we only migrate what /model
 * wrote — project/local pins are left alone.
 * Idempotent: only writes if userSettings.model matches a modelS 4.5 string.
 */
export function migratemodelS45TomodelS46(): void {
  if (getAPIProvider() !== 'firstParty') {
    return
  }

  if (!isProSubscriber() && !isMaxSubscriber() && !isTeamPremiumSubscriber()) {
    return
  }

  const model = getSettingsForSource('userSettings')?.model
  if (
    model !== 'ur-modelS-4-5-20250929' &&
    model !== 'ur-modelS-4-5-20250929[1m]' &&
    model !== 'modelS-4-5-20250929' &&
    model !== 'modelS-4-5-20250929[1m]'
  ) {
    return
  }

  const has1m = model.endsWith('[1m]')
  updateSettingsForSource('userSettings', {
    model: has1m ? 'modelS[1m]' : 'modelS',
  })

  // Skip notification for brand-new users — they never experienced the old default
  const config = getGlobalConfig()
  if (config.numStartups > 1) {
    saveGlobalConfig(current => ({
      ...current,
      modelS45To46MigrationTimestamp: Date.now(),
    }))
  }

  logEvent('tengu_modelS45_to_46_migration', {
    from_model:
      model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    has_1m: has1m,
  })
}
