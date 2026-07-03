// Assembles the Agent Status card from existing CLI JSON surfaces only:
// `ur ide status --json` (workspace/acp/plugins/warnings/sandbox/verifier)
// and `ur provider status --json` (provider capability fields), plus
// `ur --version`. Parsing is defensive — an older CLI, a transient failure,
// or an unexpected shape degrades individual fields to 'unknown' rather than
// throwing or fabricating a value.

import type { AgentStatus, KnownOrUnknown } from '../bridge/types.js'
import { runUrCliCapture, type UrCliOptions } from '../bridge/urCli.js'
import { deriveMultimodalSupport } from '../options/providerKnowledge.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function safeParseRecord(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function asKnownString<T extends string>(value: unknown, allowed: readonly T[]): KnownOrUnknown<T> {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : 'unknown'
}

function asKnownBoolean(value: unknown): KnownOrUnknown<boolean> {
  return typeof value === 'boolean' ? value : 'unknown'
}

export interface ParsedIdeStatus {
  workspaceRoot: string
  acp: AgentStatus['acp']
  pluginCount: number
  warnings: string[]
  sandboxMode: AgentStatus['sandboxMode']
  verifierMode: AgentStatus['verifierMode']
  providerLabel: string
  providerModel?: string
}

export function parseIdeStatusJson(raw: string, fallbackWorkspaceRoot = ''): ParsedIdeStatus {
  const data = safeParseRecord(raw)
  const acpRaw = isRecord(data.acp) ? data.acp : {}
  const providerRaw = isRecord(data.provider) ? data.provider : {}
  return {
    workspaceRoot: typeof data.workspaceRoot === 'string' && data.workspaceRoot ? data.workspaceRoot : fallbackWorkspaceRoot,
    acp: {
      running: Boolean(acpRaw.running),
      port: typeof acpRaw.port === 'number' ? acpRaw.port : null,
      host: typeof acpRaw.host === 'string' ? acpRaw.host : '127.0.0.1',
    },
    pluginCount: typeof data.pluginCount === 'number' ? data.pluginCount : 0,
    warnings: Array.isArray(data.warnings) ? data.warnings.filter((w): w is string => typeof w === 'string') : [],
    sandboxMode: asKnownString(data.sandboxMode, ['disabled', 'recommended', 'required'] as const),
    verifierMode: asKnownString(data.verifierMode, ['off', 'loose', 'strict'] as const),
    providerLabel: typeof providerRaw.label === 'string' ? providerRaw.label : 'Unknown provider',
    providerModel: typeof providerRaw.model === 'string' ? providerRaw.model : undefined,
  }
}

export interface ParsedProviderStatus {
  providerId?: string
  providerKind: AgentStatus['provider']['providerKind']
  usesExternalCli: KnownOrUnknown<boolean>
  supportsNativeToolCalls: KnownOrUnknown<boolean>
  supportsNativeStreaming: KnownOrUnknown<boolean>
  safetyBoundaryLabel?: string
}

export function parseProviderStatusJson(raw: string): ParsedProviderStatus {
  const data = safeParseRecord(raw)
  return {
    providerId: typeof data.provider === 'string' ? data.provider : undefined,
    providerKind: asKnownString(data.providerKind, ['ur-native', 'subscription-cli', 'subscription-placeholder'] as const),
    usesExternalCli: asKnownBoolean(data.usesExternalCli),
    supportsNativeToolCalls: asKnownBoolean(data.supportsNativeToolCalls),
    supportsNativeStreaming: asKnownBoolean(data.supportsNativeStreaming),
    safetyBoundaryLabel: typeof data.safetyBoundaryLabel === 'string' ? data.safetyBoundaryLabel : undefined,
  }
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

export interface AgentStatusCliRunner {
  (args: string[], options: UrCliOptions): Promise<{ stdout: string; stderr: string }>
}

const defaultRunner: AgentStatusCliRunner = runUrCliCapture

export async function assembleAgentStatus(cwd: string, runCli: AgentStatusCliRunner = defaultRunner): Promise<AgentStatus> {
  const [ideResult, providerResult, versionResult] = await Promise.allSettled([
    runCli(['ide', 'status', '--json'], { cwd }),
    runCli(['provider', 'status', '--json'], { cwd }),
    runCli(['--version'], { cwd }),
  ])

  const ide =
    ideResult.status === 'fulfilled'
      ? parseIdeStatusJson(ideResult.value.stdout, cwd)
      : parseIdeStatusJson('', cwd)
  const provider = providerResult.status === 'fulfilled' ? parseProviderStatusJson(providerResult.value.stdout) : parseProviderStatusJson('')
  const urVersion = versionResult.status === 'fulfilled' ? versionResult.value.stdout.trim() || 'unknown' : 'unknown'

  const warnings = [...ide.warnings]
  if (ideResult.status === 'rejected') warnings.push(`Could not read IDE status: ${errorMessage(ideResult.reason)}`)
  if (providerResult.status === 'rejected') warnings.push(`Could not read provider status: ${errorMessage(providerResult.reason)}`)

  return {
    urVersion,
    workspaceRoot: ide.workspaceRoot,
    acp: ide.acp,
    provider: {
      label: ide.providerLabel,
      model: ide.providerModel,
      providerKind: provider.providerKind,
      usesExternalCli: provider.usesExternalCli,
      supportsNativeToolCalls: provider.supportsNativeToolCalls,
      supportsNativeStreaming: provider.supportsNativeStreaming,
      multimodal: provider.providerId ? deriveMultimodalSupport(provider.providerId) : 'unknown',
      safetyBoundaryLabel: provider.safetyBoundaryLabel,
    },
    sandboxMode: ide.sandboxMode,
    verifierMode: ide.verifierMode,
    pluginCount: ide.pluginCount,
    warnings,
  }
}
