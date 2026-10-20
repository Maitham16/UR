import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isEnvTruthy } from '../envUtils.js'
import { logForDebugging } from '../debug.js'
import { getNativeResourcePath, requireNativeResource } from '../nativeResources.js'
import { getInitialSettings } from '../settings/settings.js'
import { isSourceAllowedByPolicy } from './marketplaceHelpers.js'
import { OFFICIAL_MARKETPLACE_NAME } from './officialMarketplace.js'
import { getPluginsDirectory } from './pluginDirectories.js'
import type { KnownMarketplacesFile } from './schemas.js'

/** Pure reconciliation: only an entry last registered by this installer is updated. */
export function reconcileBundledMarketplace(
  existing: KnownMarketplacesFile,
  bundledPath: string,
  previouslyManagedPath?: string,
  explicitlyDeclared = false,
): { config: KnownMarketplacesFile; changed: boolean } {
  if (explicitlyDeclared) return { config: existing, changed: false }
  const current = existing[OFFICIAL_MARKETPLACE_NAME]
  if (current) {
    if (current.source.source !== 'directory' || current.source.path !== previouslyManagedPath) {
      return { config: existing, changed: false }
    }
    if (current.source.path === bundledPath && current.installLocation === bundledPath) return { config: existing, changed: false }
  }
  return {
    changed: true,
    config: {
      ...existing,
      [OFFICIAL_MARKETPLACE_NAME]: {
        source: { source: 'directory', path: bundledPath },
        installLocation: bundledPath,
        lastUpdated: new Date().toISOString(),
        // Version changes are handled by this reconciler, never a network update.
        autoUpdate: false,
      },
    },
  }
}

/** Register the shipped catalog only. Plugin enable/install choices stay with the user. */
export async function registerNativeOfficialMarketplace(): Promise<{
  installed: boolean
  skipped: boolean
  reason?: 'already_installed' | 'policy_blocked' | 'unknown'
} | undefined> {
  const bundledPath = getNativeResourcePath('marketplace')
  if (bundledPath === null) return undefined
  if (isEnvTruthy(process.env.UR_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL)) {
    return { installed: false, skipped: true, reason: 'policy_blocked' }
  }
  const source = { source: 'directory' as const, path: bundledPath }
  if (!isSourceAllowedByPolicy(source)) return { installed: false, skipped: true, reason: 'policy_blocked' }
  try {
    requireNativeResource('marketplace/.ur-plugin/marketplace.json')
    const { loadKnownMarketplacesConfig, saveKnownMarketplacesConfig } = await import('./marketplaceManager.js')
    const marker = join(getPluginsDirectory(), 'native-marketplace.json')
    let previouslyManagedPath: string | undefined
    try {
      const parsed = JSON.parse(await readFile(marker, 'utf8'))
      if (typeof parsed.sourcePath === 'string') previouslyManagedPath = parsed.sourcePath
    } catch {
      // Missing or malformed ownership metadata grants no overwrite authority.
    }
    const reconciliation = reconcileBundledMarketplace(
      await loadKnownMarketplacesConfig(),
      bundledPath,
      previouslyManagedPath,
      Boolean(getInitialSettings().extraKnownMarketplaces?.[OFFICIAL_MARKETPLACE_NAME]),
    )
    if (!reconciliation.changed) return { installed: false, skipped: true, reason: 'already_installed' }
    await mkdir(getPluginsDirectory(), { recursive: true, mode: 0o700 })
    const temporary = `${marker}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify({ schemaVersion: 1, sourcePath: bundledPath }), { mode: 0o600 })
    await rename(temporary, marker)
    await saveKnownMarketplacesConfig(reconciliation.config)
    return { installed: true, skipped: false }
  } catch (error) {
    logForDebugging(`Could not register bundled native marketplace: ${error instanceof Error ? error.message : String(error)}`)
    return { installed: false, skipped: true, reason: 'unknown' }
  }
}
