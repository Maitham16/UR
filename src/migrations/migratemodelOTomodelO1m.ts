import { logEvent } from '../services/analytics/index.js'
import {
  getDefaultMainLoopModelSetting,
  ismodelO1mMergeEnabled,
  parseUserSpecifiedModel,
} from '../utils/model/model.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../utils/settings/settings.js'

/**
 * Migrate users with 'modelO' pinned in their settings to 'modelO[1m]' when they
 * are eligible for the merged modelO 1M experience (Max/Team Premium on 1P).
 *
 * CLI invocations with --model modelO are unaffected: that flag is a runtime
 * override and does not touch userSettings, so it continues to use plain modelO.
 *
 * Pro subscribers are skipped — they retain separate modelO and modelO 1M options.
 * 3P users are skipped — their model strings are full model IDs, not aliases.
 *
 * Idempotent: only writes if userSettings.model is exactly 'modelO'.
 */
export function migratemodelOTomodelO1m(): void {
  if (!ismodelO1mMergeEnabled()) {
    return
  }

  const model = getSettingsForSource('userSettings')?.model
  if (model !== 'modelO') {
    return
  }

  const migrated = 'modelO[1m]'
  const modelToSet =
    parseUserSpecifiedModel(migrated) ===
    parseUserSpecifiedModel(getDefaultMainLoopModelSetting())
      ? undefined
      : migrated
  updateSettingsForSource('userSettings', { model: modelToSet })

  logEvent('tengu_modelO_to_modelO1m_migration', {})
}
