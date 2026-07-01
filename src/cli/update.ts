import { homedir } from 'os'
import { logEvent } from 'src/services/analytics/index.js'
import {
  getDoctorDiagnostic,
  type InstallationType,
} from 'src/utils/doctorDiagnostic.js'
import { execFileNoThrowWithCwd } from 'src/utils/execFileNoThrow.js'
import { gracefulShutdown } from 'src/utils/gracefulShutdown.js'
import { isNetworkRestricted, offlineBlockReason } from 'src/utils/offlineMode.js'
import { writeToStdout } from 'src/utils/process.js'
import { gte } from 'src/utils/semver.js'
import { formatUpdateAvailableMessage } from 'src/utils/updateNotice.js'

export const UR_AGENT_PACKAGE_NAME = 'ur-agent'

export type NpmVersionResult =
  | { ok: true; version: string }
  | { ok: false; reason: 'registry-failure' | 'malformed-response' }

export type UpgradeCheckStatus =
  | 'development'
  | 'update-available'
  | 'up-to-date'
  | 'registry-failure'
  | 'malformed-response'

export type UpgradeCheckResult = {
  status: UpgradeCheckStatus
  exitCode: number
  currentVersion: string
  latestVersion?: string
  output: string[]
}

type UpgradeCheckDeps = {
  currentVersion: string
  packageName?: string
  installationType: InstallationType
  latestVersion: () => Promise<NpmVersionResult>
}

const SEMVER_RE =
  /^v?(?<version>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/

export function parseNpmVersion(value: string): string | null {
  const trimmed = value.trim()
  const match = trimmed.match(SEMVER_RE)
  return match?.groups?.version ?? null
}

function isDevelopmentBuild(installationType: InstallationType): boolean {
  if (installationType === 'development') {
    return true
  }
  if (process.env.NODE_ENV === 'development') {
    return true
  }

  const invokedBinary = process.argv[1] ?? ''
  return (
    invokedBinary.endsWith('/bin/ur.js') &&
    !invokedBinary.includes('/node_modules/')
  )
}

export async function getLatestNpmPackageVersion(
  packageName = UR_AGENT_PACKAGE_NAME,
): Promise<NpmVersionResult> {
  const result = await execFileNoThrowWithCwd(
    'npm',
    ['view', `${packageName}@latest`, 'version', '--prefer-online'],
    {
      cwd: homedir(),
      timeout: 30_000,
      preserveOutputOnError: true,
      audit: false,
    },
  )

  if (result.code !== 0) {
    return { ok: false, reason: 'registry-failure' }
  }

  const version = parseNpmVersion(result.stdout)
  if (!version) {
    return { ok: false, reason: 'malformed-response' }
  }

  return { ok: true, version }
}

export async function checkUpgradeStatus({
  currentVersion,
  packageName = UR_AGENT_PACKAGE_NAME,
  installationType,
  latestVersion,
}: UpgradeCheckDeps): Promise<UpgradeCheckResult> {
  const output = [
    `Current version: ${currentVersion}`,
    `Checking for updates to ${packageName}...`,
  ]

  if (isDevelopmentBuild(installationType)) {
    output.push(
      'Development build detected. To update, pull latest source or install from npm.',
    )
    return {
      status: 'development',
      exitCode: 0,
      currentVersion,
      output,
    }
  }

  const latest = await latestVersion()
  if ('reason' in latest) {
    output.push(
      latest.reason === 'malformed-response'
        ? `npm registry returned an invalid version for ${packageName}.`
        : `Unable to check npm registry for ${packageName}. Check your network and try again.`,
    )
    return {
      status: latest.reason,
      exitCode: 1,
      currentVersion,
      output,
    }
  }

  if (gte(currentVersion, latest.version)) {
    output.push('UR-AGENT is up to date.')
    return {
      status: 'up-to-date',
      exitCode: 0,
      currentVersion,
      latestVersion: latest.version,
      output,
    }
  }

  output.push(formatUpdateAvailableMessage(currentVersion, latest.version))
  output.push(`Run: npm install -g ${packageName}@latest`)
  return {
    status: 'update-available',
    exitCode: 0,
    currentVersion,
    latestVersion: latest.version,
    output,
  }
}

export async function update() {
  if (isNetworkRestricted()) {
    writeToStdout(`${offlineBlockReason('auto-update')}\n`)
    await gracefulShutdown(1)
  }

  logEvent('tengu_update_check', {})
  const diagnostic = await getDoctorDiagnostic()
  const result = await checkUpgradeStatus({
    currentVersion: MACRO.VERSION,
    packageName: UR_AGENT_PACKAGE_NAME,
    installationType: diagnostic.installationType,
    latestVersion: () => getLatestNpmPackageVersion(UR_AGENT_PACKAGE_NAME),
  })

  writeToStdout(`${result.output.join('\n')}\n`)
  await gracefulShutdown(result.exitCode)
}
