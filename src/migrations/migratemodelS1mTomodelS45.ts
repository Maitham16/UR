import {
  getMainLoopModelOverride,
  setMainLoopModelOverride,
} from '../bootstrap/state.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../utils/settings/settings.js'

/**
 * Migrate users who had "modelS[1m]" saved to the explicit "modelS-4-5-20250929[1m]".
 *
 * The "modelS" alias now resolves to modelS 4.6, so users who previously set
 * "modelS[1m]" (targeting modelS 4.5 with 1M context) need to be pinned to the
 * explicit version to preserve their intended model.
 *
 * This is needed because modelS 4.6 1M was offered to a different group of users than
 * modelS 4.5 1M, so we needed to pin existing modelS[1m] users to modelS 4.5 1M.
 *
 * Reads from userSettings specifically (not merged settings) so we don't
 * promote a project-scoped "modelS[1m]" to the global default. Runs once,
 * tracked by a completion flag in global config.
 */
export function migratemodelS1mTomodelS45(): void {
  const config = getGlobalConfig()
  if (config.modelS1m45MigrationComplete) {
    return
  }

  const model = getSettingsForSource('userSettings')?.model
  if (model === 'modelS[1m]') {
    updateSettingsForSource('userSettings', {
      model: 'modelS-4-5-20250929[1m]',
    })
  }

  // Also migrate the in-memory override if already set
  const override = getMainLoopModelOverride()
  if (override === 'modelS[1m]') {
    setMainLoopModelOverride('modelS-4-5-20250929[1m]')
  }

  saveGlobalConfig(current => ({
    ...current,
    modelS1m45MigrationComplete: true,
  }))
}
