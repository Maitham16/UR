import { request as httpRequest } from 'node:http'
import {
  resolveVisionSupport,
  type VisionSupport,
} from '../../utils/model/visionCapability.js'
import { request as httpsRequest } from 'node:https'
import type { LocalCommandCall } from '../../types/command.js'
import { getProviderApiKey } from '../../services/providers/providerCredentials.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import { createProviderClient, resolveActiveProviderModel } from '../../services/api/providerClient.js'
import { getProviderContextLengthForModel, getProviderDefinition, getScopedProviderBaseUrl, resolveProviderId } from '../../services/providers/providerRegistry.js'
import { loadModelProfile, probeModelProfile, saveModelProfile } from '../../services/providers/modelProfiles.js'
import {
  getOllamaAuthHeaders,
  getOllamaBaseUrl,
} from '../../utils/model/ollamaConfig.js'
type OllamaTag = {
  name?: string
  model?: string
  modified_at?: string
  size?: number
}

type OllamaShow = {
  capabilities?: unknown
  model_info?: Record<string, unknown>
  details?: Record<string, unknown>
}

export type ModelCapability = {
  name: string
  size?: number
  modifiedAt?: string
  advertisedCapabilities: string[]
  contextLength?: number
  embeddingLength?: number
  family?: string
  visionSupport: VisionSupport
  /** Compatibility field for existing JSON consumers. */
  likelyVision: boolean
  likelyCode: boolean
}

type JsonRequestOptions = {
  method?: 'GET' | 'POST'
  body?: string
  headers?: Record<string, string>
}

async function fetchJson<T>(
  path: string,
  options: JsonRequestOptions = {},
): Promise<T | null> {
  return new Promise(resolve => {
    let settled = false
    const finish = (value: T | null) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const url = new URL(path, getOllamaBaseUrl())
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest
    const req = request(
      url,
      {
        method: options.method ?? 'GET',
        headers: {
          'content-type': 'application/json',
          ...getOllamaAuthHeaders(process.env, getProviderApiKey('ollama')),
          ...(options.headers ?? {}),
        },
        timeout: 2_000,
      },
      response => {
        const chunks: Buffer[] = []
        response.on('data', chunk => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })
        response.on('end', () => {
          if (!response.statusCode || response.statusCode >= 400) {
            finish(null)
            return
          }
          try {
            finish(JSON.parse(Buffer.concat(chunks).toString('utf-8')) as T)
          } catch {
            finish(null)
          }
        })
      },
    )
    req.on('timeout', () => {
      req.destroy()
      finish(null)
    })
    req.on('error', () => finish(null))
    if (options.body) {
      req.write(options.body)
    }
    req.end()
  })
}

function findNumber(info: Record<string, unknown>, suffix: string): number | undefined {
  for (const [key, value] of Object.entries(info)) {
    if (!key.endsWith(suffix)) continue
    if (typeof value === 'number') return value
  }
  return undefined
}

function normalizeName(model: OllamaTag): string {
  return model.name ?? model.model ?? 'unknown'
}

export function buildOllamaShowRequestBody(name: string): string {
  return JSON.stringify({ model: name })
}

export function advertisedCapabilities(
  show: OllamaShow | null | undefined,
): string[] | null {
  if (!show || !Array.isArray(show.capabilities)) return null
  const normalized = [
    ...new Set(
      show.capabilities.flatMap(capability =>
        typeof capability === 'string' && capability.trim()
          ? [capability.trim()]
          : [],
      ),
    ),
  ]
  // `[]` is a valid, authoritative list. A non-empty array containing no
  // usable strings is malformed provider data, not proof of missing vision.
  return show.capabilities.length === 0 || normalized.length > 0
    ? normalized
    : null
}

function inferCode(name: string, family?: string): boolean {
  const lowered = `${name} ${family ?? ''}`.toLowerCase()
  return (
    lowered.includes('code') ||
    lowered.includes('coder') ||
    lowered.includes('deepseek') ||
    lowered.includes('qwen') ||
    lowered.includes('devstral')
  )
}

async function inspectModel(model: OllamaTag): Promise<ModelCapability> {
  const name = normalizeName(model)
  const show = await fetchJson<OllamaShow>('/api/show', {
    method: 'POST',
    body: buildOllamaShowRequestBody(name),
  })
  const info = show?.model_info ?? {}
  const capabilityList = advertisedCapabilities(show)
  const capabilities = capabilityList ?? []
  const visionSupport = resolveVisionSupport(
    name,
    capabilityList === null ? null : new Set(capabilityList),
  )
  const family =
    typeof show?.details?.family === 'string'
      ? show.details.family
      : typeof info['general.architecture'] === 'string'
        ? (info['general.architecture'] as string)
        : undefined

  return {
    name,
    size: model.size,
    modifiedAt: model.modified_at,
    advertisedCapabilities: capabilities,
    contextLength: findNumber(info, 'context_length'),
    embeddingLength: findNumber(info, 'embedding_length'),
    family,
    visionSupport,
    likelyVision: visionSupport === 'supported',
    likelyCode: inferCode(name, family),
  }
}

function formatBytes(size: number | undefined): string {
  if (!size) return 'unknown size'
  const gib = size / 1024 / 1024 / 1024
  return `${gib.toFixed(1)} GiB`
}

function formatReport(models: ModelCapability[]): string {
  if (models.length === 0) {
    return `No Ollama models found at ${getOllamaBaseUrl()}. Start Ollama or pull a model, then run \`ur model-doctor\` again.`
  }

  const lines = [`Ollama model capability report`, `Endpoint: ${getOllamaBaseUrl()}`, '']
  for (const model of models) {
    lines.push(model.name)
    lines.push(`  Family: ${model.family ?? 'unknown'}`)
    lines.push(`  Size: ${formatBytes(model.size)}`)
    lines.push(`  Context length: ${model.contextLength ?? 'unknown'}`)
    lines.push(`  Embedding length: ${model.embeddingLength ?? 'unknown'}`)
    lines.push(
      `  Advertised capabilities: ${
        model.advertisedCapabilities.length
          ? model.advertisedCapabilities.join(', ')
          : 'not advertised by Ollama'
      }`,
    )
    lines.push(`  Likely code-ready: ${model.likelyCode ? 'yes' : 'unknown'}`)
    lines.push(
      `  Vision support: ${
        model.visionSupport === 'supported'
          ? 'yes'
          : model.visionSupport === 'unsupported'
            ? 'no'
            : 'unknown'
      }`,
    )
    lines.push('')
  }
  lines.push(
    'Note: Ollama does not consistently advertise tool-use support in /api/tags. Treat tool support as model/provider dependent unless the model documentation says otherwise.',
  )
  return lines.join('\n')
}

/**
 * Reusable capability lookup. Queries the local Ollama app for installed models
 * and (best-effort) their advertised capabilities, context length, and inferred
 * code/vision readiness. Returns an empty list when Ollama is unreachable so
 * callers (e.g. the model router) degrade gracefully offline.
 */
export async function listModelCapabilities(
  requestedModel?: string,
): Promise<{ endpoint: string; models: ModelCapability[] }> {
  const tags = await fetchJson<{ models?: OllamaTag[] }>('/api/tags')
  const modelTags = tags?.models ?? []
  const selected = requestedModel
    ? modelTags.filter(model => normalizeName(model) === requestedModel)
    : modelTags
  const models = await Promise.all(selected.map(inspectModel))
  return { endpoint: getOllamaBaseUrl(), models }
}

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const valueFlags = new Set(['--provider', '--timeout-ms'])
  const positional = tokens.filter((token, i) => !token.startsWith('--') && !valueFlags.has(tokens[i - 1] ?? ''))
  const requestedModel = positional[0]
  const value = (flag: string) => tokens.includes(flag) ? tokens[tokens.indexOf(flag) + 1] : undefined
  if (tokens.includes('--probe') || tokens.includes('--profile') || tokens.includes('--provider')) {
    const provider = value('--provider')
    const providerId = provider ? resolveProviderId(provider) : undefined
    if (provider && !providerId) return { type: 'text', value: `Unknown provider: ${provider}` }
    if (providerId === 'subscription') return { type: 'text', value: 'Choose a configured subscription CLI provider or a native API provider.' }
    const saved = getInitialSettings()
    const settings = providerId ? { ...saved, provider: { ...saved.provider, active: providerId } } : saved
    const runtime = resolveActiveProviderModel({ settings, model: requestedModel })
    const endpoint = getScopedProviderBaseUrl(runtime.providerId, settings) ?? getProviderDefinition(runtime.providerId).defaultBaseUrl ?? 'configured-provider'
    const previous = await loadModelProfile(getCwd(), runtime.providerId, runtime.model, endpoint)
    if (!tokens.includes('--probe')) return { type: 'text', value: JSON.stringify({ runtime, profile: previous, action: 'Use --probe to measure tools, JSON output, continuation and cancellation with small real model requests.' }, null, 2) }
    const timeoutMs = value('--timeout-ms') ? Number(value('--timeout-ms')) : undefined
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300_000)) return { type: 'text', value: '--timeout-ms must be between 1000 and 300000' }
    const client = await createProviderClient(runtime.providerId, { settings, model: runtime.model, maxRetries: 0 })
    const profile = await probeModelProfile({ provider: runtime.providerId, model: runtime.model, endpoint, client, timeoutMs, contextWindow: getProviderContextLengthForModel(runtime.model, runtime.providerId, settings) })
    await saveModelProfile(getCwd(), profile)
    return { type: 'text', value: json ? JSON.stringify(profile, null, 2) : `${profile.provider} / ${profile.model}\n${Object.entries(profile.checks).map(([name, check]) => `${name}: ${check.status} — ${check.detail}`).join('\n')}\nRecorded ${profile.usage.requests} requests; ${profile.usage.inputTokens} input and ${profile.usage.outputTokens} output tokens reported by completed responses. Partial stream usage may be unavailable.\nProfiles describe observations; they never restrict model selection.` }
  }
  const { endpoint, models } = await listModelCapabilities(requestedModel)

  return {
    type: 'text',
    value: json ? JSON.stringify({ endpoint, models }, null, 2) : formatReport(models),
  }
}
