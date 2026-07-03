// Loads the real provider catalog via `ur provider list --json` and layers
// the curated multimodal derivation on top. This is the only place the
// Agent Options panel talks to the CLI — buildRecommendations() itself is
// pure and takes the resulting ProviderOption[] directly.

import type { ProviderAccessTypeValue, ProviderKindValue, ProviderOption } from '../bridge/types.js'
import { runUrCliCapture } from '../bridge/urCli.js'
import { deriveMultimodalSupport } from './providerKnowledge.js'

const PROVIDER_KINDS: readonly ProviderKindValue[] = ['ur-native', 'subscription-cli', 'subscription-placeholder']
const ACCESS_TYPES: readonly ProviderAccessTypeValue[] = ['subscription', 'api', 'local', 'server']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function parseProviderListJson(raw: string): ProviderOption[] {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []

  const options: ProviderOption[] = []
  for (const entry of data) {
    if (!isRecord(entry)) continue
    if (typeof entry.id !== 'string' || typeof entry.name !== 'string') continue
    const providerKind = PROVIDER_KINDS.includes(entry.providerKind as ProviderKindValue)
      ? (entry.providerKind as ProviderKindValue)
      : 'subscription-placeholder'
    const accessType = ACCESS_TYPES.includes(entry.accessType as ProviderAccessTypeValue)
      ? (entry.accessType as ProviderAccessTypeValue)
      : 'api'
    options.push({
      id: entry.id,
      displayName: entry.name,
      providerKind,
      accessType,
      usesExternalCli: Boolean(entry.usesExternalCli),
      supportsNativeToolCalls: Boolean(entry.supportsNativeToolCalls),
      supportsNativeStreaming: Boolean(entry.supportsNativeStreaming),
      multimodal: deriveMultimodalSupport(entry.id),
      safetyBoundaryLabel: typeof entry.safetyBoundaryLabel === 'string' ? entry.safetyBoundaryLabel : '',
    })
  }
  return options
}

/** Never throws — an empty catalog just means an empty panel, not a crash. */
export async function loadProviderOptions(cwd: string): Promise<ProviderOption[]> {
  try {
    const { stdout } = await runUrCliCapture(['provider', 'list', '--json'], { cwd })
    return parseProviderListJson(stdout)
  } catch {
    return []
  }
}
