import {
  NVIDIA_BUILD_EXECUTABLE_ENDPOINT_COUNT,
  NVIDIA_BUILD_FREE_ENDPOINT_COUNT,
  NVIDIA_BUILD_INDEX_MODEL_COUNT,
  NVIDIA_HOSTED_CATALOG_REVIEWED_AT,
  NVIDIA_HOSTED_MODEL_CONTRACTS,
  type NvidiaHostedCatalogContract,
} from './nvidiaHostedCatalog.generated.js'

/**
 * NVIDIA's public hosted catalog is generated from every current Free Endpoint
 * card's own inference reference. That includes OpenAPI, model-specific NVCF,
 * and native gRPC contracts. The OpenAI-compatible model feed is only an
 * account inventory and is never used as the public catalog's source of truth.
 */
export const NVIDIA_HOSTED_API_HOST = 'integrate.api.nvidia.com'
export const NVIDIA_HOSTED_API_BASE_URL =
  'https://integrate.api.nvidia.com/v1'
export const NVIDIA_HOSTED_CHAT_ENDPOINT =
  `${NVIDIA_HOSTED_API_BASE_URL}/chat/completions`
export {
  NVIDIA_BUILD_EXECUTABLE_ENDPOINT_COUNT,
  NVIDIA_BUILD_FREE_ENDPOINT_COUNT,
  NVIDIA_BUILD_INDEX_MODEL_COUNT,
  NVIDIA_HOSTED_CATALOG_REVIEWED_AT,
}

export type NvidiaHostedAgentModelContract = NvidiaHostedCatalogContract & {
  supportedParameters: string[]
  capabilities: Record<string, unknown>
}

export type NvidiaHostedTaskKind =
  | '3d-generation'
  | 'active-speaker-detection'
  | 'audio-enhancement'
  | 'autonomous-driving'
  | 'biology'
  | 'change-detection'
  | 'content-safety'
  | 'document-parsing'
  | 'image-analysis'
  | 'image-editing'
  | 'image-generation'
  | 'image-understanding'
  | 'information-extraction'
  | 'medical-imaging'
  | 'molecular-modeling'
  | 'multimodal-embedding'
  | 'object-detection'
  | 'reranking'
  | 'route-optimization'
  | 'speech-generation'
  | 'speech-to-speech'
  | 'specialized-inference'
  | 'text-embedding'
  | 'text-generation'
  | 'translation'
  | 'video-generation'
  | 'video-analysis'
  | 'visual-analysis'
  | 'weather-simulation'

export type NvidiaHostedTaskModelContract = NvidiaHostedCatalogContract & {
  taskKind: NvidiaHostedTaskKind
  inputMediaTypes: string[]
  outputMediaType: string
  outputExtension?: string
}

function inputMediaTypes(contract: NvidiaHostedCatalogContract): string[] {
  const schema = JSON.stringify(contract.requestSchema).toLowerCase()
  const media = ['application/json']
  const kind = contract.taskKind ?? ''
  if (/image|jpeg|png/u.test(schema)) media.push('image/jpeg', 'image/png')
  if (
    /video|mp4/u.test(schema) ||
    /active-speaker-detection|video-analysis/u.test(kind)
  ) {
    media.push('video/mp4')
  }
  if (
    /audio|wav|speech/u.test(`${schema} ${kind}`) ||
    kind === 'active-speaker-detection'
  ) {
    media.push('audio/wav', 'audio/mpeg')
  }
  return [...new Set(media)]
}

function outputContract(contract: NvidiaHostedCatalogContract): {
  outputMediaType: string
  outputExtension?: string
} {
  if (
    contract.taskKind === 'image-generation' ||
    contract.taskKind === 'image-editing'
  ) {
    return { outputMediaType: 'image/jpeg', outputExtension: '.jpg' }
  }
  if (contract.taskKind === 'video-generation') {
    return { outputMediaType: 'video/mp4', outputExtension: '.mp4' }
  }
  if (contract.taskKind === '3d-generation') {
    return { outputMediaType: 'model/gltf-binary', outputExtension: '.glb' }
  }
  if (
    contract.taskKind === 'audio-enhancement' ||
    contract.taskKind === 'speech-generation' ||
    contract.taskKind === 'speech-to-speech'
  ) {
    return { outputMediaType: 'audio/wav', outputExtension: '.wav' }
  }
  if (
    contract.taskKind === 'active-speaker-detection' ||
    contract.taskKind === 'video-analysis'
  ) {
    return { outputMediaType: 'application/json', outputExtension: '.json' }
  }
  if (contract.taskKind === 'autonomous-driving') {
    return { outputMediaType: 'video/mp4', outputExtension: '.mp4' }
  }
  const binary = contract.responseMediaTypes.find(type =>
    /octet-stream|application\/zip|application\/x-tar/u.test(type),
  )
  if (binary) {
    return {
      outputMediaType: binary,
      outputExtension: binary.includes('zip')
        ? '.zip'
        : binary.includes('tar')
          ? '.tar'
          : '.bin',
    }
  }
  return { outputMediaType: 'application/json' }
}

const agentContracts = NVIDIA_HOSTED_MODEL_CONTRACTS
  .filter(contract => contract.agent)
  .map(contract => ({
    ...contract,
    supportedParameters: [
      ...new Set([
        ...Object.keys(contract.requestSchema.properties ?? {}),
        // A model-card agent contract is an explicit NVIDIA capability claim
        // even when the embedded OpenAPI schema is less specific than the
        // card (for example Mistral-Nemotron function calling).
        'tools',
      ]),
    ],
    capabilities: {
      agent: true,
      toolCalling: true,
      streaming: contract.supportsStreaming,
      endpoint: contract.endpoint,
      available: contract.available,
      executable: contract.executable,
      capabilitySource: contract.agentCapabilitySource,
      ...(/image|vision|multimodal|video/iu.test(
        `${contract.purpose} ${JSON.stringify(contract.requestSchema)}`,
      )
        ? { vision: true }
        : {}),
    },
  })) satisfies NvidiaHostedAgentModelContract[]

export const NVIDIA_HOSTED_TASK_MODEL_CONTRACTS =
  NVIDIA_HOSTED_MODEL_CONTRACTS
    .filter(
      (contract): contract is NvidiaHostedCatalogContract & {
        taskKind: NvidiaHostedTaskKind
      } => !contract.agent && Boolean(contract.taskKind),
    )
    .map(contract => ({
      ...contract,
      inputMediaTypes: inputMediaTypes(contract),
      ...outputContract(contract),
    })) satisfies NvidiaHostedTaskModelContract[]

const contractsByModel = new Map<string, NvidiaHostedAgentModelContract>(
  agentContracts.map(entry => [entry.id.toLowerCase(), entry]),
)
const taskContractsByModel = new Map<string, NvidiaHostedTaskModelContract>(
  NVIDIA_HOSTED_TASK_MODEL_CONTRACTS.map(entry => [
    entry.id.toLowerCase(),
    entry,
  ]),
)

export function getNvidiaHostedAgentModelContract(
  modelId: string,
): NvidiaHostedAgentModelContract | undefined {
  return contractsByModel.get(modelId.trim().toLowerCase())
}

export function getNvidiaHostedTaskModelContract(
  modelId: string,
): NvidiaHostedTaskModelContract | undefined {
  return taskContractsByModel.get(modelId.trim().toLowerCase())
}

export function nvidiaHostedTaskModelIds(): string[] {
  return NVIDIA_HOSTED_TASK_MODEL_CONTRACTS.map(entry => entry.id)
}

export function isNvidiaHostedApi(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === NVIDIA_HOSTED_API_HOST
  } catch {
    return false
  }
}

/**
 * Custom and enterprise NIM gateways keep their saved URL. Public NVIDIA
 * hosted models use the exact endpoint recorded in NVIDIA's OpenAPI contract.
 */
export function resolveNvidiaHostedModelEndpoint(
  baseUrl: string,
  modelId: string,
): string | undefined {
  if (!isNvidiaHostedApi(baseUrl)) return undefined
  return getNvidiaHostedAgentModelContract(modelId)?.endpoint
}

export function nvidiaHostedAgentModelIds(): string[] {
  return agentContracts.map(entry => entry.id)
}
