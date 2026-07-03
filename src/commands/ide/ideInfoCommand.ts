import { getAcpServerPort } from '../../services/agents/acpServer.js'
import {
  formatIdeConfig,
  formatIdeDoctor,
  formatIdeStatus,
  generateIdeConfig,
  IDE_TARGETS,
  resolveIdeTarget,
  type IdeStatus,
} from '../../services/agents/ideConfig.js'
import { getProviderRuntimeInfo } from '../../services/providers/providerRegistry.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'
import { detectRunningIDEs, toIDEDisplayName } from '../../utils/ide.js'
import { loadInstalledPluginsV2 } from '../../utils/plugins/installedPluginsManager.js'
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js'

// Read-only current-mode getters, composed from existing exported reads —
// no sandbox or verifier runtime behavior is changed by adding a status
// field. SandboxManager.isSandboxingEnabled()/isSandboxRequired() are the
// same zero-arg checks `ur sandbox status` already uses.
function currentSandboxMode(): IdeStatus['sandboxMode'] {
  if (!SandboxManager.isSandboxingEnabled()) return 'disabled'
  return SandboxManager.isSandboxRequired() ? 'required' : 'recommended'
}

// Mirrors the 3-line resolution in src/services/verifier/index.ts's
// (module-private) resolveMode(): env var wins, else default to 'strict'.
// Reproduced here as a plain env read rather than importing verifier
// internals, since this command's scope is a read-only status snapshot.
function currentVerifierMode(): IdeStatus['verifierMode'] {
  const env = (process.env.UR_VERIFIER_MODE ?? '').toLowerCase()
  if (env === 'off' || env === 'loose' || env === 'strict') return env
  return 'strict'
}

function pluginCount(): number {
  try {
    return Object.keys(loadInstalledPluginsV2().plugins ?? {}).length
  } catch {
    return 0
  }
}

async function detectedIdeNames(): Promise<{ names: string[]; warning?: string }> {
  try {
    const ides = await detectRunningIDEs()
    return { names: ides.map(toIDEDisplayName) }
  } catch (error) {
    return { names: [], warning: `IDE detection failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}

export async function collectIdeStatus(cwd: string): Promise<IdeStatus> {
  const port = getAcpServerPort()
  const runtime = getProviderRuntimeInfo()
  const detected = await detectedIdeNames()
  const warnings: string[] = []
  if (detected.warning) warnings.push(detected.warning)
  if (!runtime.model) warnings.push('No model selected. Run /model or: ur config set model <model>.')
  return {
    workspaceRoot: cwd,
    acp: { running: port !== null, port, host: '127.0.0.1' },
    provider: {
      label: runtime.providerLabel,
      model: runtime.model,
      runtimeBackend: runtime.runtimeBackend,
      authLabel: runtime.authLabel,
      ready: Boolean(runtime.model),
    },
    pluginCount: pluginCount(),
    detectedIdes: detected.names.map(name => ({ name, connected: false })),
    warnings,
    sandboxMode: currentSandboxMode(),
    verifierMode: currentVerifierMode(),
  }
}

function usage(): string {
  return [
    'Usage:',
    '  ur ide status [--json]',
    '  ur ide doctor [--json]',
    `  ur ide config <${IDE_TARGETS.map(t => t.id).join('|')}> [--json]`,
  ].join('\n')
}

export async function runIdeInfoCommand(args: string, cwd = getCwd()): Promise<string> {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const positional = tokens.filter(t => !t.startsWith('--'))
  const action = positional[0] ?? 'status'

  if (action === 'status') {
    return formatIdeStatus(await collectIdeStatus(cwd), json)
  }
  if (action === 'doctor') {
    return formatIdeDoctor(await collectIdeStatus(cwd), json)
  }
  if (action === 'config') {
    const targetArg = positional[1]
    if (!targetArg) {
      return `Choose an IDE target: ${IDE_TARGETS.map(t => t.id).join(', ')}\n${usage()}`
    }
    const target = resolveIdeTarget(targetArg)
    if (!target) {
      return `Unknown IDE "${targetArg}". Supported: ${IDE_TARGETS.map(t => t.id).join(', ')}`
    }
    return formatIdeConfig(generateIdeConfig(target.id), json)
  }
  return usage()
}
