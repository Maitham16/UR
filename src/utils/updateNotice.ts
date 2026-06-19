import { gte } from './semver.js'

export function isUpdateAvailable(
  currentVersion: string | null | undefined,
  latestVersion: string | null | undefined,
): boolean {
  return Boolean(
    currentVersion &&
      latestVersion &&
      !gte(currentVersion, latestVersion),
  )
}

export function formatUpdateAvailableMessage(
  currentVersion: string,
  latestVersion: string,
): string {
  return `Update available: ${currentVersion} -> ${latestVersion}`
}
