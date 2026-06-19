import { logEvent } from 'src/services/analytics/index.js'
import { isProSubscriber } from '../utils/auth.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { getAPIProvider } from '../utils/model/providers.js'
import { getSettings_DEPRECATED } from '../utils/settings/settings.js'

export function resetProTomodelODefault(): void {
  const config = getGlobalConfig()

  if (config.modelOProMigrationComplete) {
    return
  }

  const apiProvider = getAPIProvider()

  // Pro users on firstParty get auto-migrated to modelO 4.5 default
  if (apiProvider !== 'firstParty' || !isProSubscriber()) {
    saveGlobalConfig(current => ({
      ...current,
      modelOProMigrationComplete: true,
    }))
    logEvent('tengu_reset_pro_to_modelO_default', { skipped: true })
    return
  }

  const settings = getSettings_DEPRECATED()

  // Only show notification if user was on default (no custom model setting)
  if (settings?.model === undefined) {
    const modelOProMigrationTimestamp = Date.now()
    saveGlobalConfig(current => ({
      ...current,
      modelOProMigrationComplete: true,
      modelOProMigrationTimestamp,
    }))
    logEvent('tengu_reset_pro_to_modelO_default', {
      skipped: false,
      had_custom_model: false,
    })
  } else {
    // User has a custom model setting, just mark migration complete
    saveGlobalConfig(current => ({
      ...current,
      modelOProMigrationComplete: true,
    }))
    logEvent('tengu_reset_pro_to_modelO_default', {
      skipped: false,
      had_custom_model: true,
    })
  }
}
