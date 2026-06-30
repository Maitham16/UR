/**
 * Privacy level controls how much nonessential network traffic and telemetry
 * UR generates.
 *
 * Levels are ordered by restrictiveness:
 *   default < no-telemetry < essential-traffic
 *
 * - default:            Everything enabled.
 * - no-telemetry:       Analytics/telemetry disabled (Datadog, 1P events, feedback survey).
 * - essential-traffic:  ALL nonessential network traffic disabled
 *                       (telemetry + auto-updates, grove, release notes, model capabilities, etc.).
 *
 * The resolved level is the most restrictive signal from:
 *   UR_CODE_DISABLE_NONESSENTIAL_TRAFFIC  →  essential-traffic
 *   DISABLE_TELEMETRY                         →  no-telemetry
 */

type PrivacyLevel = 'default' | 'no-telemetry' | 'essential-traffic'

export function getPrivacyLevel(): PrivacyLevel {
  if (process.env.UR_CODE_DISABLE_NONESSENTIAL_TRAFFIC) {
    return 'essential-traffic'
  }
  if (process.env.DISABLE_TELEMETRY) {
    return 'no-telemetry'
  }
  if (isNetworkRestricted()) {
    return 'essential-traffic'
  }
  return 'default'
}

function isNetworkRestricted(): boolean {
  return (
    process.env.UR_OFFLINE === '1' ||
    process.env.UR_NO_CLOUD === '1' ||
    ['1', 'true', 'yes', 'on'].includes((process.env.UR_OFFLINE ?? '').toLowerCase().trim()) ||
    ['1', 'true', 'yes', 'on'].includes((process.env.UR_NO_CLOUD ?? '').toLowerCase().trim())
  )
}

/**
 * True when all nonessential network traffic should be suppressed.
 * Equivalent to the old `process.env.UR_CODE_DISABLE_NONESSENTIAL_TRAFFIC` check.
 */
export function isEssentialTrafficOnly(): boolean {
  return getPrivacyLevel() === 'essential-traffic'
}

/**
 * True when telemetry/analytics should be suppressed.
 * True at both `no-telemetry` and `essential-traffic` levels.
 */
export function isTelemetryDisabled(): boolean {
  return getPrivacyLevel() !== 'default'
}

/**
 * Returns the env var name responsible for the current essential-traffic restriction,
 * or null if unrestricted. Used for user-facing "unset X to re-enable" messages.
 */
export function getEssentialTrafficOnlyReason(): string | null {
  if (process.env.UR_CODE_DISABLE_NONESSENTIAL_TRAFFIC) {
    return 'UR_CODE_DISABLE_NONESSENTIAL_TRAFFIC'
  }
  return null
}
