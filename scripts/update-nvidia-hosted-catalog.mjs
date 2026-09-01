#!/usr/bin/env node

import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const DOCS_BASE = 'https://docs.api.nvidia.com/nim/reference'
const OUTPUT = resolve(
  process.cwd(),
  'src/services/providers/nvidiaHostedCatalog.generated.ts',
)
const CATEGORY_PAGES = [
  'llm-apis',
  'retrieval-apis',
  'visual-models-apis',
  'multimodal-apis',
  'healthcare-apis',
  'route-optimization-apis',
  'climate-simulation-apis',
]
const PUBLIC_HOSTS = new Set([
  'ai.api.nvidia.com',
  'climate.api.nvidia.com',
  'health.api.nvidia.com',
  'integrate.api.nvidia.com',
  'optimize.api.nvidia.com',
])
const PROVIDER_ALIASES = new Map([
  ['black forest labs', 'black-forest-labs'],
  ['moonshot ai', 'moonshotai'],
  ['thinking machines', 'thinkingmachines'],
])

function propsFromHtml(html, url) {
  const marker = '<script id="ssr-props"'
  const tail = html.split(marker)[1]
  if (!tail) throw new Error(`NVIDIA documentation returned no SSR data: ${url}`)
  const body = tail.slice(tail.indexOf('>') + 1, tail.indexOf('</script>'))
  return JSON.parse(body)
}

async function fetchDocument(slug) {
  const url = `${DOCS_BASE}/${slug}`
  const response = await fetch(url, {
    headers: { 'User-Agent': 'UR-Nexus-NVIDIA-catalog-updater/1' },
  })
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
  return propsFromHtml(await response.text(), url).document
}

function tableOperations(markdown, category) {
  const operations = []
  for (const line of markdown.split('\n')) {
    const links = [...line.matchAll(/\[([^\]]+)\]\(ref:([^)]+)\)/g)]
    if (links.length !== 2) continue
    let [model, operation] = links
    if (/status|earlier function invocation/iu.test(operation[1])) continue
    if (!model[1].includes('/') && operation[1].includes('/')) {
      ;[model, operation] = [operation, model]
    }
    if (!model[1].includes('/')) continue
    operations.push({
      category,
      displayModel: model[1],
      modelSlug: model[2],
      purpose: operation[1],
      operationSlug: operation[2],
    })
  }
  return operations
}

function normalizeModelId(displayModel) {
  const [rawProvider, ...rawModel] = displayModel.split('/')
  const provider = rawProvider.trim().toLowerCase()
  const canonicalProvider = PROVIDER_ALIASES.get(provider) ?? provider.replace(/\s+/gu, '-')
  return `${canonicalProvider}/${rawModel.join('/').trim()}`
}

function resolveSchema(schema, components) {
  if (!schema || typeof schema !== 'object') return schema
  if (typeof schema.$ref !== 'string') return schema
  const name = schema.$ref.split('/').at(-1)
  return components?.[name] ?? schema
}

function compactSchema(schema, components, depth = 0, seen = new Set()) {
  const resolved = resolveSchema(schema, components)
  if (!resolved || typeof resolved !== 'object') return {}
  const reference = typeof schema?.$ref === 'string' ? schema.$ref : undefined
  if (reference && seen.has(reference)) return { $ref: reference }
  const nextSeen = new Set(seen)
  if (reference) nextSeen.add(reference)

  const output = {}
  for (const key of [
    'type',
    'format',
    'title',
    'default',
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'minLength',
    'maxLength',
    'minItems',
    'maxItems',
  ]) {
    if (resolved[key] !== undefined) output[key] = resolved[key]
  }
  if (typeof resolved.description === 'string') {
    output.description = resolved.description.replace(/\s+/gu, ' ').trim().slice(0, 600)
  }
  if (Array.isArray(resolved.enum)) output.enum = resolved.enum
  if (Array.isArray(resolved.required)) output.required = resolved.required
  if (depth >= 6) return output
  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    if (Array.isArray(resolved[key])) {
      output[key] = resolved[key].map(entry =>
        compactSchema(entry, components, depth + 1, nextSeen),
      )
    }
  }
  if (resolved.items) {
    output.items = compactSchema(resolved.items, components, depth + 1, nextSeen)
  }
  if (resolved.properties && typeof resolved.properties === 'object') {
    output.properties = Object.fromEntries(
      Object.entries(resolved.properties).map(([name, value]) => [
        name,
        compactSchema(value, components, depth + 1, nextSeen),
      ]),
    )
  }
  if (resolved.additionalProperties !== undefined) {
    output.additionalProperties =
      typeof resolved.additionalProperties === 'object'
        ? compactSchema(
            resolved.additionalProperties,
            components,
            depth + 1,
            nextSeen,
          )
        : resolved.additionalProperties
  }
  return output
}

function normalizeServer(server) {
  if (!server) return undefined
  return /^https?:\/\//iu.test(server) ? server : `https://${server}`
}

function endpointUrl(server, path) {
  const normalizedServer = normalizeServer(server)
  if (!normalizedServer) return undefined
  const url = new URL(normalizedServer)
  const serverPath = url.pathname.replace(/\/+$/u, '')
  const operationPath = path.startsWith('/') ? path : `/${path}`
  url.pathname =
    serverPath.endsWith('/v1') && operationPath.startsWith('/v1/')
      ? operationPath
      : `${serverPath}/${operationPath.replace(/^\/+/, '')}`
  return url.toString().replace(/\/$/u, '')
}

function cardAdvertisesAgentTools(body) {
  const normalized = String(body ?? '').replace(/\s+/gu, ' ')
  return /(?:supports?[^.]{0,100}(?:function|tool) calling|designed[^.]{0,140}tool use|tool calling capabilities|agentic workflows?[^.]{0,120}tool calling|trained[^.]{0,120}tool calling|tasks?, such as RAG and tool calling|multi-step tool use)/iu.test(
    normalized,
  )
}

function taskKind(category, model, endpoint, purpose, schema) {
  const value = `${model} ${endpoint} ${purpose}`.toLowerCase()
  const properties = schema?.properties ?? {}
  if (/rerank/u.test(value)) return 'reranking'
  if (/embedding|\/embeddings/u.test(value)) {
    return /image|vision|vl-|nvclip/u.test(value)
      ? 'multimodal-embedding'
      : 'text-embedding'
  }
  if (/stable-video|text2world|video diffusion/u.test(value)) return 'video-generation'
  if (/trellis|3d/u.test(value)) return '3d-generation'
  if (/flux\.1-kontext|image-to-image/u.test(value)) return 'image-editing'
  if (/flux|stable-diffusion|diffusiongemma/u.test(value)) return 'image-generation'
  if (/visual-changenet/u.test(value)) return 'change-detection'
  if (/grounding-dino|object-detection|bevformer|sparsedrive|streampetr/u.test(value)) {
    return 'object-detection'
  }
  if (/dinov2|image-detection/u.test(value)) return 'image-analysis'
  if (/nemoguard|content-safety|llama-guard|jailbreak/u.test(value)) return 'content-safety'
  if (/translate/u.test(value)) return 'translation'
  if (/gliner/u.test(value)) return 'information-extraction'
  if (/parse/u.test(value)) return 'document-parsing'
  if (category === 'healthcare-apis') {
    if (/molecule|molmim|genmol|diffdock/u.test(value)) return 'molecular-modeling'
    if (/vista/u.test(value)) return 'medical-imaging'
    return 'biology'
  }
  if (category === 'route-optimization-apis') return 'route-optimization'
  if (category === 'climate-simulation-apis') return 'weather-simulation'
  if (category === 'multimodal-apis' || category === 'visual-models-apis') {
    if (properties.messages) return 'image-understanding'
    return 'visual-analysis'
  }
  return properties.messages ? 'text-generation' : 'specialized-inference'
}

function taskPurpose(kind, summary, model) {
  const cleaned = summary.replace(/\s*\([^)]*\)?\s*$/u, '').trim()
  if (cleaned && !/^(?:infer|request response from the model|request generation|create(?:s)? a model response)$/iu.test(cleaned)) {
    return cleaned
  }
  const purposes = {
    '3d-generation': 'Generate a 3D asset from text or an image',
    'change-detection': 'Compare reference and test images for visual changes',
    'content-safety': 'Classify content against the model’s safety policy',
    'document-parsing': 'Parse document content into structured text',
    'image-analysis': 'Analyze or classify an image',
    'image-editing': 'Edit an input image from a text instruction',
    'image-generation': 'Generate an image from a text prompt',
    'image-understanding': 'Answer a question about image content',
    'information-extraction': 'Extract structured entities from text',
    'medical-imaging': 'Run the documented medical-imaging inference task',
    'molecular-modeling': 'Run the documented molecular modeling task',
    'multimodal-embedding': 'Create embeddings for text or image input',
    'object-detection': 'Detect and localize objects in visual input',
    reranking: 'Rank passages by relevance to a query',
    'route-optimization': 'Solve a structured route-optimization problem',
    'specialized-inference': 'Run the model’s documented specialized inference operation',
    'text-embedding': 'Create vector embeddings from text',
    'text-generation': 'Generate one text response without owning the agent loop',
    translation: 'Translate text using the documented language contract',
    'video-generation': 'Generate a video from an input image',
    'visual-analysis': 'Run the model’s documented visual analysis task',
    'weather-simulation': 'Run the documented weather or climate simulation',
    biology: 'Run the documented biological inference task',
  }
  return `${purposes[kind] ?? 'Run the documented hosted inference task'} (${model})`
}

function preferredModelId(displayModel, schema) {
  const displayed = normalizeModelId(displayModel)
  const value = schema?.properties?.model?.default
  if (typeof value !== 'string' || !value.includes('/')) return displayed
  const comparable = input => input.toLowerCase().replace(/[^a-z0-9]/gu, '')
  const displayedComparable = comparable(displayed)
  const valueComparable = comparable(value)
  return displayedComparable.includes(valueComparable) ||
    valueComparable.includes(displayedComparable)
    ? value
    : displayed
}

async function loadOperation(candidate) {
  const [operationDocument, modelDocument] = await Promise.all([
    fetchDocument(candidate.operationSlug),
    fetchDocument(candidate.modelSlug).catch(() => undefined),
  ])
  const api = operationDocument.api
  if (!api?.schema || api.method?.toLowerCase() !== 'post') return undefined
  const operation = api.schema.paths?.[api.path]?.[api.method]
  const requestContent = operation?.requestBody?.content ?? {}
  const requestType = Object.keys(requestContent).find(type =>
    type.includes('json'),
  )
  if (!operation || !requestType) return undefined
  const endpoint = endpointUrl(api.schema.servers?.[0]?.url, api.path)
  if (!endpoint) return undefined
  const host = new URL(endpoint).hostname.toLowerCase()
  if (!PUBLIC_HOSTS.has(host)) return undefined

  const components = api.schema.components?.schemas ?? {}
  const requestSchema = compactSchema(
    requestContent[requestType]?.schema ?? {},
    components,
  )
  const model = preferredModelId(candidate.displayModel, requestSchema)
  const properties = requestSchema.properties ?? {}
  const chatEndpoint = /\/chat\/completions$/iu.test(new URL(endpoint).pathname)
  const schemaTools = Boolean(properties.tools)
  const modelCardTools = chatEndpoint && cardAdvertisesAgentTools(
    modelDocument?.content?.body,
  )
  const agent = chatEndpoint && (schemaTools || modelCardTools)
  const generatedTaskKind = agent
    ? undefined
    : taskKind(
        candidate.category,
        model,
        endpoint,
        candidate.purpose,
        requestSchema,
      )
  const responseMediaTypes = [
    ...new Set(
      Object.values(operation.responses ?? {}).flatMap(response =>
        Object.keys(response?.content ?? {}),
      ),
    ),
  ]

  return {
    id: model,
    displayName: candidate.displayModel.replace(/\s*\/\s*/u, ' / '),
    category: candidate.category,
    endpoint,
    documentation: `${DOCS_BASE}/${candidate.operationSlug}`,
    documentationUpdatedAt: operationDocument.updated_at,
    purpose: agent
      ? candidate.purpose.replace(/\s*\([^)]*\)\s*$/u, '').trim()
      : taskPurpose(generatedTaskKind, candidate.purpose, model),
    agent,
    agentCapabilitySource: schemaTools
      ? 'request-schema'
      : modelCardTools
        ? 'model-card'
        : 'none',
    taskKind: generatedTaskKind,
    requestContentType: requestType,
    requestSchema,
    responseMediaTypes,
    supportsStreaming: Boolean(properties.stream),
  }
}

async function main() {
  const candidates = []
  for (const category of CATEGORY_PAGES) {
    const document = await fetchDocument(category)
    candidates.push(
      ...tableOperations(document.content?.body ?? '', category),
    )
  }

  let cursor = 0
  const loaded = new Array(candidates.length)
  async function worker() {
    while (cursor < candidates.length) {
      const index = cursor++
      try {
        loaded[index] = await loadOperation(candidates[index])
      } catch (error) {
        console.warn(
          `Skipping ${candidates[index].displayModel}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }
  await Promise.all(Array.from({ length: 12 }, () => worker()))

  const byId = new Map()
  for (const contract of loaded.filter(Boolean)) {
    const existing = byId.get(contract.id.toLowerCase())
    if (!existing || (!existing.agent && contract.agent)) {
      byId.set(contract.id.toLowerCase(), contract)
    }
  }
  const contracts = [...byId.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  )
  const reviewedAt = contracts
    .map(contract => contract.documentationUpdatedAt)
    .filter(Boolean)
    .sort()
    .at(-1)
  const source = `/**\n * Generated from NVIDIA's public NIM OpenAPI reference.\n * Do not hand-edit; run \`bun run provider:nvidia-catalog\`.\n */\n\nexport type NvidiaHostedCatalogContract = {\n  id: string\n  displayName: string\n  category: string\n  endpoint: string\n  documentation: string\n  documentationUpdatedAt?: string\n  purpose: string\n  agent: boolean\n  agentCapabilitySource: 'request-schema' | 'model-card' | 'none'\n  taskKind?: string\n  requestContentType: string\n  requestSchema: Record<string, unknown>\n  responseMediaTypes: string[]\n  supportsStreaming: boolean\n}\n\nexport const NVIDIA_HOSTED_CATALOG_REVIEWED_AT = ${JSON.stringify(reviewedAt)}\n\nexport const NVIDIA_HOSTED_MODEL_CONTRACTS: readonly NvidiaHostedCatalogContract[] = ${JSON.stringify(contracts, null, 2)}\n`
  await writeFile(OUTPUT, source)
  const agents = contracts.filter(contract => contract.agent).length
  console.log(
    `Wrote ${contracts.length} NVIDIA hosted contracts (${agents} agent, ${contracts.length - agents} task) to ${OUTPUT}`,
  )
}

await main()
