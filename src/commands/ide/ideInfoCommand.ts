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
