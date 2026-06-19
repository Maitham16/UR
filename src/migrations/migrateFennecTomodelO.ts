import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../utils/settings/settings.js'

/**
 * Migrate users on removed fennec model aliases to their new modelO 4.6 aliases.
 * - fennec-latest → modelO
 * - fennec-latest[1m] → modelO[1m]
 * - fennec-fast-latest → modelO[1m] + fast mode
 * - modelO-4-5-fast → modelO + fast mode
 *
 * Only touches userSettings. Reading and writing the same source keeps this
 * idempotent without a completion flag. Fennec aliases in project/local/policy
 * settings are left alone — we can't rewrite those, and reading merged
 * settings here would cause infinite re-runs + silent global promotion.
 */
export function migrateFennecTomodelO(): void {
  if (process.env.USER_TYPE !== 'ant') {
    return
  }

  const settings = getSettingsForSource('userSettings')

  const model = settings?.model
  if (typeof model === 'string') {
    if (model.startsWith('fennec-latest[1m]')) {
      updateSettingsForSource('userSettings', {
        model: 'modelO[1m]',
      })
    } else if (model.startsWith('fennec-latest')) {
      updateSettingsForSource('userSettings', {
        model: 'modelO',
      })
    } else if (
      model.startsWith('fennec-fast-latest') ||
      model.startsWith('modelO-4-5-fast')
    ) {
      updateSettingsForSource('userSettings', {
        model: 'modelO[1m]',
        fastMode: true,
      })
    }
  }
}
