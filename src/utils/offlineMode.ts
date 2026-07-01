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
import { existsSync } from 'node:fs'
import { join } from 'node:path'

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

export type LocalFirstProfile = {
  offline: boolean
  envTriggers: string[]
  posture: string[]
  strengths: string[]
  localCapabilities: Array<{
    name: string
    available: boolean
    detail: string
  }>
  blockedCloudSurfaces: string[]
  recommendedCommands: string[]
}

export function localFirstProfile(cwd = process.cwd()): LocalFirstProfile {
  const summary = offlineModeSummary()
  const hasUrDir = existsSync(join(cwd, '.ur'))
  const hasGit = existsSync(join(cwd, '.git'))
  const hasVerify = existsSync(join(cwd, '.ur', 'verify.json'))
  const hasModelPool = existsSync(join(cwd, '.ur', 'model-pool.json'))
  const hasCodeIndex = existsSync(join(cwd, '.ur', 'code-index')) ||
    existsSync(join(cwd, '.ur', 'index'))

  return {
    offline: summary.offline,
    envTriggers: summary.envTriggers,
    posture: [
      'no cloud required',
      'private codebase friendly',
      'research lab / airgapped workflow ready',
      'offline environment compatible',
      'edge and server development oriented',
    ],
    strengths: [
      'local Ollama model routing for cheap/simple and strong/local coding tasks',
      'project-local memory, specs, verification config, and run traces under .ur/',
      'filesystem, git, terminal, Docker, test-runner, and code-index workflows can run without SaaS upload',
      'offline mode blocks telemetry, auto-update, OAuth/login, browser automation, remote control, and cloud API surfaces',
    ],
    localCapabilities: [
      {
        name: 'project .ur directory',
        available: hasUrDir,
        detail: hasUrDir ? '.ur exists for project-local state' : 'run ur init or a UR agent command to create .ur',
      },
      {
        name: 'git repository',
        available: hasGit,
        detail: hasGit ? 'git metadata is local and available' : 'no .git directory detected at cwd',
      },
      {
        name: 'verification gates',
        available: hasVerify,
        detail: hasVerify ? '.ur/verify.json configured' : 'run ur test-first install to create .ur/verify.json',
      },
      {
        name: 'model pool',
        available: hasModelPool,
        detail: hasModelPool ? '.ur/model-pool.json configured' : 'using built-in/env local model pools',
      },
      {
        name: 'semantic/code index',
        available: hasCodeIndex,
        detail: hasCodeIndex ? 'local index artifacts detected' : 'run ur code-index build --repo to build local repo knowledge',
      },
    ],
    blockedCloudSurfaces: summary.blockedCategories,
    recommendedCommands: [
      'ur --offline',
      'UR_OFFLINE=1 ur -p "your task"',
      'ur model-route "your task" --strategy auto',
      'ur test-first run --dry-run',
      'ur code-index build --repo',
      'ur eval run <suite> --offline --dry-run',
    ],
  }
}

export function formatLocalFirstProfile(profile: LocalFirstProfile, json: boolean): string {
  if (json) return JSON.stringify(profile, null, 2)
  const lines = [
    `Local-first mode: ${profile.offline ? 'active' : 'available'}`,
    profile.envTriggers.length ? `Env triggers: ${profile.envTriggers.join(', ')}` : 'Env triggers: none',
    '',
    'Posture:',
    ...profile.posture.map(item => `  - ${item}`),
    '',
    'Strengths:',
    ...profile.strengths.map(item => `  - ${item}`),
    '',
    'Local capabilities:',
    ...profile.localCapabilities.map(capability =>
      `  - ${capability.available ? 'yes' : 'no '} ${capability.name}: ${capability.detail}`,
    ),
    '',
    'Cloud surfaces blocked in offline mode:',
    ...profile.blockedCloudSurfaces.map(item => `  - ${item}`),
    '',
    'Recommended local-first commands:',
    ...profile.recommendedCommands.map(command => `  ${command}`),
  ]
  return lines.join('\n')
}
