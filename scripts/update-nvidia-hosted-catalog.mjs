#!/usr/bin/env node

import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const BUILD_BASE = 'https://build.nvidia.com'
const INDEX_URL = `${BUILD_BASE}/models.md`
const OUTPUT = resolve(
  process.cwd(),
  'src/services/providers/nvidiaHostedCatalog.generated.ts',
)
const USER_AGENT = 'UR-Nexus-NVIDIA-catalog-updater/2'
const PREVIEW_LABEL = 'nimType:endpoint:nim_type_preview'
const PUBLIC_HTTP_HOSTS = new Set([
  'ai.api.nvidia.com',
  'climate.api.nvidia.com',
  'health.api.nvidia.com',
  'integrate.api.nvidia.com',
  'optimize.api.nvidia.com',
])

const NVIDIA_GRPC_INFERENCE_CONTRACTS = {
  'nvidia/active-speaker-detection': {
    method: 'BIDIRECTIONAL_STREAM',
    rpcService:
      'nvidia.ai4m.activespeakerdetection.v1.ActiveSpeakerDetectionService',
    rpcMethod: 'DetectActiveSpeaker',
    requestSchema: {
      type: 'object',
      required: ['video_path', 'diarization_path'],
      properties: {
        video_path: { type: 'string', description: 'H.264 MP4 input path.' },
        audio_path: {
          type: 'string',
          description: 'Optional separate WAV, MP3, or Opus audio path.',
        },
        diarization_path: {
          type: 'string',
          description: 'Optional word-level speaker diarization JSON path.',
        },
        speaker_detection_threshold: {
          type: 'number',
          exclusiveMinimum: 0,
          exclusiveMaximum: 1,
        },
      },
    },
    responseSchema: {
      type: 'object',
      properties: {
        frames: {
          type: 'array',
          description: 'Per-frame bounding boxes, face IDs, speaker IDs, speaking flags, and confidence scores.',
        },
      },
    },
    responseMediaTypes: ['application/json'],
    inputHint: 'Streams H.264 MP4 video with optional separate audio and diarization data.',
    outputHint: 'Returns per-frame active-speaker detections as structured JSON.',
  },
  'nvidia/bnr': {
    method: 'BIDIRECTIONAL_STREAM',
    rpcService: 'nvidia.ai4m.bnr.v1.BNR',
    rpcMethod: 'EnhanceAudio',
    requestSchema: {
      type: 'object',
      required: ['audio_path'],
      properties: {
        audio_path: { type: 'string', description: 'Input WAV audio path.' },
        intensity_ratio: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    responseSchema: {
      type: 'string',
      format: 'binary',
      description: 'Enhanced WAV audio.',
    },
    responseMediaTypes: ['audio/wav'],
    inputHint: 'Streams one WAV audio file, optionally with an intensity ratio from 0 to 1.',
    outputHint: 'Returns the enhanced WAV audio stream.',
  },
  'nvidia/magpie-tts-zeroshot': {
    method: 'UNARY',
    rpcService: 'nvidia.riva.tts.RivaSpeechSynthesis',
    rpcMethod: 'Synthesize',
    requestSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', description: 'Text to synthesize.' },
        reference_audio_path: {
          type: 'string',
          description: 'Optional 3-to-10-second reference audio for zero-shot voice cloning.',
        },
        language_code: { type: 'string', default: 'en-US' },
        voice_name: { type: 'string' },
        sample_rate_hz: { type: 'integer', default: 22050 },
        quality: { type: 'integer', minimum: 1, maximum: 40, default: 20 },
        transcript: { type: 'string' },
      },
    },
    responseSchema: {
      type: 'string',
      format: 'binary',
      description: 'Synthesized audio.',
    },
    responseMediaTypes: ['audio/wav'],
    inputHint: 'Synthesizes text with a built-in voice or a 3-to-10-second reference voice sample.',
    outputHint: 'Returns synthesized audio as a WAV artifact.',
  },
  'nvidia/studiovoice': {
    method: 'BIDIRECTIONAL_STREAM',
    rpcService: 'nvidia.ai4m.studiovoice.v1.StudioVoice',
    rpcMethod: 'EnhanceAudio',
    requestSchema: {
      type: 'object',
      required: ['audio_path'],
      properties: {
        audio_path: { type: 'string', description: 'Input WAV audio path.' },
      },
    },
    responseSchema: {
      type: 'string',
      format: 'binary',
      description: 'Studio-quality enhanced WAV audio.',
    },
    responseMediaTypes: ['audio/wav'],
    inputHint: 'Streams one WAV audio file for studio-quality speech enhancement.',
    outputHint: 'Returns the enhanced WAV audio stream.',
  },
  'nvidia/synthetic-video-detector': {
    method: 'BIDIRECTIONAL_STREAM',
    rpcService:
      'nvidia.maxine.syntheticvideodetector.v1.SyntheticVideoDetectorService',
    rpcMethod: 'DetectSyntheticVideo',
    requestSchema: {
      type: 'object',
      required: ['video_path'],
      properties: {
        video_path: {
          type: 'string',
          description: 'H.264 constant-frame-rate MP4 input path.',
        },
      },
    },
    responseSchema: {
      type: 'object',
      properties: {
        verdict: { type: 'string', enum: ['synthetic', 'real', 'unknown'] },
        final: { type: 'object' },
        clips: { type: 'array' },
      },
    },
    responseMediaTypes: ['application/json'],
    inputHint: 'Streams one H.264 constant-frame-rate MP4 file for synthetic-video analysis.',
    outputHint: 'Returns clip scores and the final synthetic probability as JSON.',
  },
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
  return response.text()
}

function nextPayloads(html) {
  const payloads = []
  for (const match of html.matchAll(
    /<script>self\.__next_f\.push\((.*?)\)<\/script>/gs,
  )) {
    try {
      const value = JSON.parse(match[1])
      if (Array.isArray(value) && typeof value[1] === 'string') {
        payloads.push(value[1])
      }
    } catch {
      // Unrelated Next.js payloads do not participate in model parity.
    }
  }
  return payloads
}

function balancedObject(source, start) {
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') quoted = false
      continue
    }
    if (character === '"') quoted = true
    else if (character === '{') depth += 1
    else if (character === '}' && --depth === 0) {
      return source.slice(start, index + 1)
    }
  }
  return undefined
}

function objectAfter(source, key) {
  const index = source.indexOf(key)
  if (index < 0) return undefined
  const raw = balancedObject(source, index + key.length)
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function objectsAfter(source, key) {
  const values = []
  let offset = 0
  while (offset < source.length) {
    const index = source.indexOf(key, offset)
    if (index < 0) break
    const start = index + key.length
    const raw = balancedObject(source, start)
    if (raw) {
      try {
        values.push(JSON.parse(raw))
      } catch {
        // A malformed or unrelated object cannot describe this model card.
      }
      offset = start + raw.length
    } else {
      offset = start
    }
  }
  return values
}

function embeddedCard(html) {
  const payloads = nextPayloads(html)
  const joinedPayload = payloads.join('\n')
  for (const payload of payloads) {
    const initialState = objectAfter(payload, '"initialState":')
    if (initialState?.artifact?.artifactType) {
      const standaloneSpecs = payloads.flatMap(candidate =>
        objectsAfter(candidate, '"spec":'),
      )
      const matchingSpec = standaloneSpecs.find(
        candidate => candidate?.artifactName === initialState.artifact.name,
      )
      const unambiguousSpec =
        standaloneSpecs.filter(candidate => candidate?.openAPISpec).length === 1
          ? standaloneSpecs.find(candidate => candidate?.openAPISpec)
          : undefined
      return {
        artifact: initialState.artifact,
        endpointSpec: matchingSpec ?? unambiguousSpec ?? {
          openAPISpec: initialState.openApiSpec,
          updatedDate: initialState.artifact.updatedDate,
          attributes: {},
        },
        payload: joinedPayload,
      }
    }

    const artifact = objectAfter(payload, '"artifact":')
    if (!artifact?.artifactType) continue
    return {
      artifact,
      endpointSpec: objectAfter(payload, '"endpointSpec":') ?? {},
      payload: joinedPayload,
    }
  }
  return undefined
}

function modelIndexEntries(markdown) {
  const entries = new Map()
  for (const match of markdown.matchAll(
    /- \[([^\]]+)\]\((\/[^)]+\.md)\) — ([^\n]+)/g,
  )) {
    entries.set(match[2], {
      title: match[1],
      path: match[2],
      description: match[3].trim(),
    })
  }
  return [...entries.values()]
}

function advertisesPreview(card) {
  const labels = Array.isArray(card.artifact.labels)
    ? card.artifact.labels
    : []
  return (
    labels.some(label => String(label).includes('nim_type_preview')) ||
    card.artifact.attributes?.some(
      attribute =>
        attribute?.key === 'PREVIEW' && attribute?.value === 'true',
    )
  )
}

function resolveSchema(schema, components) {
  if (!schema || typeof schema !== 'object') return schema
  if (typeof schema.$ref !== 'string') return schema
  return components?.[schema.$ref.split('/').at(-1)] ?? schema
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
    'const',
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
    output.description = resolved.description.replace(/\s+/gu, ' ').trim().slice(0, 900)
  }
  if (Array.isArray(resolved.enum)) output.enum = resolved.enum
  if (Array.isArray(resolved.required)) output.required = resolved.required
  if (depth >= 8) return output
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

function endpointUrl(server, path) {
  if (typeof server !== 'string' || !server.trim()) return undefined
  let url
  try {
    url = new URL(server)
  } catch {
    return undefined
  }
  if (!PUBLIC_HTTP_HOSTS.has(url.hostname.toLowerCase())) return undefined
  const serverPath = url.pathname.replace(/\/+$/u, '')
  const operationPath = path.startsWith('/') ? path : `/${path}`
  url.pathname =
    serverPath.endsWith('/v1') && operationPath.startsWith('/v1/')
      ? operationPath
      : `${serverPath}/${operationPath.replace(/^\/+/, '')}`
  return url.toString().replace(/\/$/u, '')
}

function requestProperties(operation, spec) {
  const content = operation?.requestBody?.content ?? {}
  const type = Object.keys(content).find(value => value.includes('json'))
  const schema = type ? content[type]?.schema : undefined
  const resolved = resolveSchema(schema, spec?.components?.schemas ?? {})
  return resolved?.properties ?? {}
}

function cardText(entry, card) {
  const labels = Array.isArray(card.artifact.labels)
    ? card.artifact.labels.join(' ')
    : ''
  return `${entry.title} ${entry.description} ${card.artifact.shortDescription ?? ''} ${labels}`
}

function isAgentContract(entry, card, operation, path) {
  if (!/\/(?:chat\/completions|responses)$/iu.test(path)) return false
  const properties = requestProperties(operation, card.endpointSpec.openAPISpec)
  if (properties.tools) return true
  return (
    card.endpointSpec?.attributes?.modelCapability?.functionCalling === true &&
    /(?:\bagentic\b|\bagents?\b|tool[- ](?:call|calling|use)|function calling|terminal tasks?)/iu.test(
      cardText(entry, card),
    )
  )
}

function taskKind(model, purpose, endpoint, schema, labels) {
  const value = `${model} ${purpose} ${endpoint ?? ''} ${labels.join(' ')}`.toLowerCase()
  const properties = schema?.properties ?? {}
  if (/active-speaker/u.test(value)) return 'active-speaker-detection'
  if (/background noise|\/bnr\b/u.test(value)) return 'audio-enhancement'
  if (/studio.?voice/u.test(value)) return 'audio-enhancement'
  if (/tts|text.to.speech|magpie/u.test(value)) return 'speech-generation'
  if (/voicechat|speech.to.speech/u.test(value)) return 'speech-to-speech'
  if (/synthetic-video-detector/u.test(value)) return 'video-analysis'
  if (/rerank/u.test(value)) return 'reranking'
  if (/embedding|\/embeddings/u.test(value)) {
    return /image|vision|vl-|nvclip/u.test(value)
      ? 'multimodal-embedding'
      : 'text-embedding'
  }
  if (/bevformer|sparsedrive|streampetr|autonomous driv/u.test(value)) {
    return 'autonomous-driving'
  }
  if (
    /(?:video generation|generates? (?:physics-aware )?videos?|text.to.video|image.to.video|text2world|cosmos-transfer|cosmos3-nano(?!-reasoner))/u.test(
      value,
    )
  ) {
    return 'video-generation'
  }
  if (/video (?:analysis|understanding)|understands? (?:images, )?video/u.test(value)) {
    return 'video-analysis'
  }
  if (/trellis|3d generation/u.test(value)) return '3d-generation'
  if (/image.edit|flux\.1-kontext/u.test(value)) return 'image-editing'
  if (/image generation|flux|stable-diffusion|diffusiongemma/u.test(value)) {
    return properties.messages ? 'text-generation' : 'image-generation'
  }
  if (/translate/u.test(value)) return 'translation'
  if (/content.safety|llama.guard|safety.guard/u.test(value)) return 'content-safety'
  if (/object detection/u.test(value)) return 'object-detection'
  if (/paligemma|image.to.text|vision language|multimodal/u.test(value)) {
    return 'image-understanding'
  }
  if (properties.messages) return 'text-generation'
  return 'specialized-inference'
}

function outputMediaTypes(operation) {
  return [
    ...new Set(
      Object.values(operation?.responses ?? {}).flatMap(response =>
        Object.keys(response?.content ?? {}),
      ),
    ),
  ]
}

function responseSchema(operation, spec) {
  const response = Object.entries(operation?.responses ?? {})
    .filter(([status]) => /^(?:2\d\d|default)$/u.test(status))
    .map(([, value]) => value)
    .find(Boolean)
  const content = response?.content ?? {}
  const type =
    Object.keys(content).find(value => value.includes('json')) ??
    Object.keys(content)[0]
  return compactSchema(
    type ? content[type]?.schema ?? {} : {},
    spec?.components?.schemas ?? {},
  )
}

function attributeValue(artifact, key) {
  return artifact.attributes?.find(attribute => attribute?.key === key)?.value
}

function cardUrl(entry) {
  return `${BUILD_BASE}${entry.path.replace(/\.md$/u, '')}`
}

function cleanHint(value, fallback) {
  return typeof value === 'string' && value.trim() && !/^\$[0-9a-z]/iu.test(value)
    ? value.trim()
    : fallback
}

function documentedOperations(spec) {
  const operations = []
  for (const [path, pathItem] of Object.entries(spec?.paths ?? {})) {
    if (/\/status(?:\/|$)/iu.test(path)) continue
    for (const method of ['post', 'put', 'patch', 'get', 'delete']) {
      const operation = pathItem?.[method]
      if (!operation) continue
      operations.push({ path, method: method.toUpperCase(), operation })
    }
  }
  return operations
}

function chooseOperation(entry, card, operations) {
  const agentCandidates = operations.filter(candidate =>
    isAgentContract(entry, card, candidate.operation, candidate.path),
  )
  // UR's NVIDIA Agentic adapter speaks Chat Completions. When a card documents
  // both Responses and Chat Completions, select the exact Chat Completions
  // inference route instead of sending a chat-shaped body to /responses.
  const agent =
    agentCandidates.find(candidate =>
      /\/chat\/completions$/iu.test(candidate.path),
    ) ?? agentCandidates[0]
  if (agent) return { ...agent, agent: true }
  const preferred =
    operations.find(candidate => candidate.method === 'POST') ?? operations[0]
  return preferred ? { ...preferred, agent: false } : undefined
}

function documentationUrl(entry, card) {
  const configured = card.endpointSpec?.attributes?.apiDocsUrl
  if (typeof configured === 'string' && /^https:\/\//u.test(configured)) {
    return configured
  }
  return `${cardUrl(entry)}/api`
}

function preferredModelId(card, endpoint, requestSchema) {
  const modelProperty = requestSchema?.properties?.model
  const documented =
    typeof modelProperty?.default === 'string'
      ? modelProperty.default
      : Array.isArray(modelProperty?.enum) &&
          typeof modelProperty.enum[0] === 'string'
        ? modelProperty.enum[0]
        : undefined
  if (documented?.includes('/')) return documented

  try {
    const segments = new URL(endpoint).pathname.split('/').filter(Boolean)
    const familyIndex = segments.findIndex(segment =>
      /^(?:vlm|genai|cv|av|biology)$/iu.test(segment),
    )
    if (familyIndex >= 0 && segments.length >= familyIndex + 3) {
      return `${segments.at(-2)}/${segments.at(-1)}`
    }
  } catch {
    // The endpoint was already validated; retain the card identity if a future
    // URL format does not expose a publisher/model suffix.
  }
  return `${card.artifact.publisher}/${card.artifact.name}`
}

function httpContract(entry, card, selected) {
  const spec = card.endpointSpec.openAPISpec
  const functionId = card.endpointSpec?.nvcfFunctionId
  const endpoint =
    endpointUrl(spec?.servers?.[0]?.url, selected.path) ??
    (typeof functionId === 'string' && functionId.trim()
      ? `https://${functionId}.invocation.api.nvcf.nvidia.com${selected.path.startsWith('/') ? selected.path : `/${selected.path}`}`
      : undefined)
  if (!endpoint) return undefined
  const requestContent = selected.operation.requestBody?.content ?? {}
  const requestContentType =
    Object.keys(requestContent).find(type => type.includes('json')) ??
    Object.keys(requestContent)[0] ??
    'application/json'
  const components = spec?.components?.schemas ?? {}
  const requestSchema = compactSchema(
    requestContent[requestContentType]?.schema ?? {},
    components,
  )
  const properties = requestSchema.properties ?? {}
  const labels = Array.isArray(card.artifact.labels) ? card.artifact.labels : []
  const id = preferredModelId(card, endpoint, requestSchema)
  return {
    id,
    displayName: `${card.artifact.publisher} / ${card.artifact.displayName ?? card.artifact.name}`,
    category: selected.agent ? 'agentic' : 'special',
    transport: 'http',
    endpoint,
    method: selected.method,
    ...(typeof functionId === 'string' && functionId.trim()
      ? { functionId }
      : {}),
    documentation: documentationUrl(entry, card),
    buildCard: cardUrl(entry),
    documentationUpdatedAt:
      card.endpointSpec.updatedDate ?? card.artifact.updatedDate,
    available: attributeValue(card.artifact, 'AVAILABLE') !== 'false',
    executable: true,
    purpose: entry.description,
    agent: selected.agent,
    agentCapabilitySource: properties.tools ? 'request-schema' : 'model-card',
    taskKind: selected.agent
      ? undefined
      : taskKind(id, entry.description, endpoint, requestSchema, labels),
    requestContentType,
    requestSchema,
    responseSchema: responseSchema(selected.operation, spec),
    responseMediaTypes: outputMediaTypes(selected.operation),
    supportsStreaming:
      Boolean(properties.stream) ||
      outputMediaTypes(selected.operation).includes('text/event-stream'),
    inputHint: cleanHint(selected.operation.summary, entry.description),
    outputHint: cleanHint(
      selected.operation?.['x-nvai-meta']?.returns ??
        selected.operation.description,
      'Returns the response documented by NVIDIA for this model.',
    ),
  }
}

function grpcContract(entry, card) {
  const functionId = card.endpointSpec?.nvcfFunctionId
  if (typeof functionId !== 'string' || !functionId.trim()) return undefined
  const labels = Array.isArray(card.artifact.labels) ? card.artifact.labels : []
  const id = `${card.artifact.publisher}/${card.artifact.name}`
  const inference = NVIDIA_GRPC_INFERENCE_CONTRACTS[id]
  return {
    id,
    displayName: `${card.artifact.publisher} / ${card.artifact.displayName ?? card.artifact.name}`,
    category: 'special',
    transport: inference ? 'grpc' : 'unpublished',
    endpoint: inference ? 'grpc.nvcf.nvidia.com:443' : cardUrl(entry),
    method: inference?.method ?? 'UNPUBLISHED',
    ...(inference
      ? { rpcService: inference.rpcService, rpcMethod: inference.rpcMethod }
      : {}),
    functionId,
    documentation: documentationUrl(entry, card),
    buildCard: cardUrl(entry),
    documentationUpdatedAt:
      card.endpointSpec.updatedDate ?? card.artifact.updatedDate,
    available: attributeValue(card.artifact, 'AVAILABLE') !== 'false',
    executable: Boolean(inference),
    purpose: entry.description,
    agent: false,
    agentCapabilitySource: 'none',
    taskKind: taskKind(id, entry.description, undefined, {}, labels),
    requestContentType: 'application/grpc+proto',
    requestSchema: inference?.requestSchema ?? {},
    responseSchema: inference?.responseSchema ?? {},
    responseMediaTypes: inference?.responseMediaTypes ?? [],
    supportsStreaming: inference?.method === 'BIDIRECTIONAL_STREAM',
    inputHint:
      inference?.inputHint ??
      'NVIDIA labels this as a Free Endpoint but has not published an inference protocol for it.',
    outputHint:
      inference?.outputHint ??
      'No public response contract is currently published by NVIDIA.',
  }
}

async function loadEntry(entry) {
  const html = await fetchText(`${BUILD_BASE}${entry.path.replace(/\.md$/u, '')}`)
  const card = embeddedCard(html)
  if (!card || card.artifact.artifactType !== 'ENDPOINT') return undefined
  if (!advertisesPreview(card)) return undefined

  const operations = documentedOperations(card.endpointSpec.openAPISpec)
  const selected = chooseOperation(entry, card, operations)
  const contract = selected
    ? httpContract(entry, card, selected) ?? grpcContract(entry, card)
    : grpcContract(entry, card)
  if (!contract) {
    throw new Error(
      `${card.artifact.publisher}/${card.artifact.name} advertises a Free Endpoint but its model page exposes neither a public NVIDIA inference URL nor an NVCF function ID.`,
    )
  }
  return contract
}

async function main() {
  const entries = modelIndexEntries(await fetchText(INDEX_URL))
  if (entries.length === 0) throw new Error(`${INDEX_URL} returned no model cards.`)

  let cursor = 0
  const loaded = new Array(entries.length)
  async function worker() {
    while (cursor < entries.length) {
      const index = cursor++
      loaded[index] = await loadEntry(entries[index])
    }
  }
  await Promise.all(Array.from({ length: 12 }, () => worker()))

  const contractsById = new Map()
  for (const contract of loaded.filter(Boolean)) {
    const key = contract.id.toLowerCase()
    const existing = contractsById.get(key)
    if (!existing || (!existing.agent && contract.agent)) {
      contractsById.set(key, contract)
    }
  }
  const contracts = [...contractsById.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  )
  if (contracts.length === 0) {
    throw new Error('NVIDIA Build exposed no executable Free Endpoint contracts.')
  }

  const reviewedAt = new Date().toISOString()
  const executable = contracts.filter(contract => contract.executable).length
  const source = `/**\n * Generated from each Free Endpoint model card's embedded NVIDIA inference contract.\n * Every route is model-specific; do not hand-edit or replace one with a generic endpoint.\n * Run \`bun run provider:nvidia-catalog\` to refresh from build.nvidia.com.\n */\n\nexport type NvidiaHostedCatalogContract = {\n  id: string\n  displayName: string\n  category: 'agentic' | 'special'\n  transport: 'http' | 'grpc' | 'unpublished'\n  endpoint: string\n  method: string\n  rpcService?: string\n  rpcMethod?: string\n  functionId?: string\n  documentation: string\n  buildCard: string\n  documentationUpdatedAt?: string\n  available: boolean\n  executable: boolean\n  purpose: string\n  agent: boolean\n  agentCapabilitySource: 'request-schema' | 'model-card' | 'none'\n  taskKind?: string\n  requestContentType: string\n  requestSchema: Record<string, unknown>\n  responseSchema: Record<string, unknown>\n  responseMediaTypes: string[]\n  supportsStreaming: boolean\n  inputHint: string\n  outputHint: string\n}\n\nexport const NVIDIA_HOSTED_CATALOG_REVIEWED_AT = ${JSON.stringify(reviewedAt)}\nexport const NVIDIA_BUILD_INDEX_MODEL_COUNT = ${entries.length}\nexport const NVIDIA_BUILD_FREE_ENDPOINT_COUNT = ${contracts.length}\nexport const NVIDIA_BUILD_EXECUTABLE_ENDPOINT_COUNT = ${executable}\n\nexport const NVIDIA_HOSTED_MODEL_CONTRACTS: readonly NvidiaHostedCatalogContract[] = ${JSON.stringify(contracts, null, 2)}\n`
  await writeFile(OUTPUT, source)
  const agents = contracts.filter(contract => contract.agent).length
  const grpc = contracts.filter(contract => contract.transport === 'grpc').length
  console.log(
    `Wrote ${contracts.length} exact NVIDIA Build Free Endpoint contracts (${agents} agentic, ${contracts.length - agents} special, ${grpc} gRPC) from ${entries.length} visible cards to ${OUTPUT}`,
  )
}

await main()
