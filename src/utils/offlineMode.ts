/**
 * Offline / local-first mode helpers.
 *
 * --offline disables cloud APIs, telemetry, auto-updates, remote control, and
 * web-dependent commands. Local Ollama, filesystem, git, and shell tools still
 * work. This makes UR usable in airgapped labs, private codebases, and edge
 * environments without leaking data or hanging on unreachable services.
 */

import { getOfflineMode, setOfflineMode } from '../bootstrap/state.js'
import { isEnvTruthy } from './envUtils.js'

export { getOfflineMode, setOfflineMode }

export function isNetworkRestricted(): boolean {
  return (
    getOfflineMode() ||
    isEnvTruthy(process.env.UR_OFFLINE) ||
    isEnvTruthy(process.env.UR_NO_CLOUD)
  )
}

export type OfflineBlockReason =
  | 'cloud-api'
  | 'telemetry'
  | 'auto-update'
  | 'remote-control'
  | 'web-browser'
  | 'network-command'
  | 'oauth'

const REASON_LABELS: Record<OfflineBlockReason, string> = {
  'cloud-api': 'cloud API call',
  telemetry: 'telemetry upload',
  'auto-update': 'auto-update check',
  'remote-control': 'remote control / bridge',
  'web-browser': 'web browser automation',
  'network-command': 'network shell command',
  oauth: 'OAuth / login flow',
}

export function offlineBlockReason(kind: OfflineBlockReason): string {
  return `Blocked ${REASON_LABELS[kind]}: UR is in offline/local-first mode. Run without --offline or unset UR_OFFLINE to enable cloud features.`
}

export function offlineModeSummary(): {
  offline: boolean
  envTriggers: string[]
  blockedCategories: string[]
} {
  const envTriggers: string[] = []
  if (isEnvTruthy(process.env.UR_OFFLINE)) envTriggers.push('UR_OFFLINE')
  if (isEnvTruthy(process.env.UR_NO_CLOUD)) envTriggers.push('UR_NO_CLOUD')
  return {
    offline: isNetworkRestricted(),
    envTriggers,
    blockedCategories: [
      'cloud model APIs',
      'telemetry',
      'auto-updates',
      'remote control',
      'web browser automation',
      'OAuth login',
    ],
  }
}
