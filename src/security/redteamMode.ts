import { getSessionId } from '../bootstrap/state.js'
import {
  getInitialSettings,
  updateSettingsForSource,
} from '../utils/settings/settings.js'

export const REDTEAM_WARNING_VERSION = 1

export const REDTEAM_WARNING = `WARNING: redteam mode enables UR's unrestricted security-research policy for this session.

Security research can damage or destabilize systems, expose or destroy data, trigger monitoring or legal controls, and violate laws, contracts, or service terms. Use it only on systems you own or are explicitly authorized to test.

UR still enforces target scope, execution permissions, sandboxing, and audit controls. Your selected model/provider may apply its own policies. You are responsible for every target and action; UR cannot guarantee containment.

Run \`/mode redteam --accept-risk\` to acknowledge this warning and activate the mode.`

const activeSessions = new Set<string>()

function sessionKey(): string {
  return String(getSessionId())
}

export function isRedteamModeActive(): boolean {
  return activeSessions.has(sessionKey())
}

export function hasAcceptedRedteamWarning(): boolean {
  return (
    getInitialSettings().redteamWarningAcceptedVersion ===
    REDTEAM_WARNING_VERSION
  )
}

export function acceptRedteamWarning(): { error: Error | null } {
  return updateSettingsForSource('userSettings', {
    redteamWarningAcceptedVersion: REDTEAM_WARNING_VERSION,
    redteamWarningAcceptedAt: new Date().toISOString(),
  })
}

export function activateRedteamMode(): void {
  activeSessions.add(sessionKey())
}

export function deactivateRedteamMode(): void {
  activeSessions.delete(sessionKey())
}

export function resetRedteamModeForTests(): void {
  activeSessions.clear()
}
