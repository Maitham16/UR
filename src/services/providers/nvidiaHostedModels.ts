import {
  NVIDIA_HOSTED_CATALOG_REVIEWED_AT,
  NVIDIA_HOSTED_MODEL_CONTRACTS,
  type NvidiaHostedCatalogContract,
} from './nvidiaHostedCatalog.generated.js'

/**
 * NVIDIA's public hosted NIM catalog is generated from the official OpenAPI
 * reference instead of being inferred from the OpenAI-compatible model feed.
 * The feed is an account inventory; the generated contracts are the source of
 * truth for each model's endpoint and request family.
 */
export const NVIDIA_HOSTED_API_HOST = 'integrate.api.nvidia.com'
export const NVIDIA_HOSTED_API_BASE_URL =
  'https://integrate.api.nvidia.com/v1'
export const NVIDIA_HOSTED_CHAT_ENDPOINT =
  `${NVIDIA_HOSTED_API_BASE_URL}/chat/completions`
export { NVIDIA_HOSTED_CATALOG_REVIEWED_AT }

export type NvidiaHostedAgentModelContract = NvidiaHostedCatalogContract & {
  supportedParameters: string[]
  capabilities: Record<string, unknown>
}

export type NvidiaHostedTaskKind =
  | '3d-generation'
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
  | 'specialized-inference'
  | 'text-embedding'
  | 'text-generation'
  | 'translation'
  | 'video-generation'
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
  if (/image|jpeg|png/u.test(schema)) media.push('image/jpeg', 'image/png')
  if (/video|mp4/u.test(schema)) media.push('video/mp4')
  return media
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
    supportedParameters: ['tools'],
    capabilities: {
      agent: true,
      toolCalling: true,
      streaming: contract.supportsStreaming,
      endpoint: contract.endpoint,
      capabilitySource: contract.agentCapabilitySource,
      ...(contract.category === 'multimodal-apis' ||
      contract.category === 'visual-models-apis'
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
