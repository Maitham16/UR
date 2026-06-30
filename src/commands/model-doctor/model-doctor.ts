import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getOllamaBaseUrl } from '../../utils/model/ollamaConfig.js'
type OllamaTag = {
  name?: string
  model?: string
  modified_at?: string
  size?: number
}

type OllamaShow = {
  capabilities?: string[]
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

function inferVision(name: string, capabilities: string[]): boolean {
  const lowered = name.toLowerCase()
  return (
    capabilities.includes('vision') ||
    lowered.includes('vision') ||
    lowered.includes('llava') ||
    lowered.includes('moondream') ||
    lowered.includes('minicpm-v')
  )
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
  const capabilities = show?.capabilities ?? []
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
    likelyVision: inferVision(name, capabilities),
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
    lines.push(`  Likely vision-ready: ${model.likelyVision ? 'yes' : 'no/unknown'}`)
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
  const requestedModel = tokens.find(token => !token.startsWith('--'))
  const { endpoint, models } = await listModelCapabilities(requestedModel)

  return {
    type: 'text',
    value: json ? JSON.stringify({ endpoint, models }, null, 2) : formatReport(models),
  }
}
