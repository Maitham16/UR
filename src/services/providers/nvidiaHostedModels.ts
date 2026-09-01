/**
 * Audited contracts for NVIDIA's public hosted NIM service.
 *
 * The hosted `/v1/models` feed contains chat models, utility models, and
 * dedicated inference functions. Presence in that feed is therefore only an
 * availability signal, not proof that a model can run UR's multi-turn tool
 * loop. Keep this list deliberately positive: a public hosted model is
 * selectable only when NVIDIA documents an agent/tool contract for it.
 *
 * Contract review: 2026-09-01
 * Index: https://docs.api.nvidia.com/nim/reference/llm-apis
 */

export const NVIDIA_HOSTED_API_HOST = 'integrate.api.nvidia.com'
export const NVIDIA_HOSTED_API_BASE_URL =
  'https://integrate.api.nvidia.com/v1'
export const NVIDIA_HOSTED_CHAT_ENDPOINT =
  `${NVIDIA_HOSTED_API_BASE_URL}/chat/completions`

export type NvidiaHostedAgentModelContract = {
  id: string
  endpoint: string
  documentation: string
  supportedParameters: string[]
  capabilities: Record<string, unknown>
}

export type NvidiaHostedTaskKind =
  | 'text-to-image'
  | 'image-to-video'
  | 'image-understanding'

export type NvidiaHostedTaskModelContract = {
  id: string
  displayName: string
  endpoint: string
  documentation: string
  taskKind: NvidiaHostedTaskKind
  purpose: string
  inputMediaTypes: string[]
  outputMediaType: string
  outputExtension?: string
}

type ContractInput = {
  id: string
  documentation: string
  vision?: boolean
}

const contract = ({
  id,
  documentation,
  vision = false,
}: ContractInput): NvidiaHostedAgentModelContract => ({
  id,
  endpoint: NVIDIA_HOSTED_CHAT_ENDPOINT,
  documentation,
  supportedParameters: ['tools'],
  capabilities: {
    agent: true,
    toolCalling: true,
    streaming: true,
    ...(vision ? { vision: true } : {}),
  },
})

/**
 * NVIDIA-hosted models with a documented multi-turn tool-use contract.
 *
 * Some model pages describe tool use in the model contract while others also
 * expose `tools` directly in their OpenAPI request schema. Both are explicit
 * NVIDIA capability statements. Models documented only for generation,
 * classification, retrieval, translation, parsing, or tool-free VLM inference
 * are intentionally absent.
 */
const NVIDIA_HOSTED_AGENT_MODEL_CONTRACTS = [
  contract({ id: 'deepseek-ai/deepseek-v4-flash', documentation: 'deepseek-ai-deepseek-v4-flash' }),
  contract({ id: 'deepseek-ai/deepseek-v4-flash-0731', documentation: 'deepseek-ai-deepseek-v4-flash-0731' }),
  contract({ id: 'deepseek-ai/deepseek-v4-pro', documentation: 'deepseek-ai-deepseek-v4-pro' }),
  contract({ id: 'deepseek-ai/deepseek-v4-pro-0813', documentation: 'deepseek-ai-deepseek-v4-pro-0813' }),
  contract({ id: 'meta/llama-3.1-8b-instruct', documentation: 'meta-llama-3_1-8b' }),
  contract({ id: 'meta/llama-3.1-70b-instruct', documentation: 'meta-llama-3_1-70b' }),
  contract({ id: 'meta/llama-3.3-70b-instruct', documentation: 'meta-llama-3_3-70b-instruct' }),
  contract({ id: 'meta/muse-glimmer-30b', documentation: 'meta-muse-glimmer-30b', vision: true }),
  contract({ id: 'microsoft/phi-4-mini-instruct', documentation: 'microsoft-phi-4-mini-instruct' }),
  contract({ id: 'minimaxai/minimax-m3', documentation: 'minimaxai-minimax-m3', vision: true }),
  contract({ id: 'mistralai/mistral-nemotron', documentation: 'mistralai-mistral-nemotron' }),
  contract({ id: 'moonshotai/kimi-k2.5', documentation: 'moonshotai-kimi-k2-5', vision: true }),
  contract({ id: 'moonshotai/kimi-k2.6', documentation: 'moonshotai-kimi-k2-6', vision: true }),
  contract({ id: 'moonshotai/kimi-k2-instruct', documentation: 'moonshotai-kimi-k2-instruct' }),
  contract({ id: 'moonshotai/kimi-k2-thinking', documentation: 'moonshotai-kimi-k2-thinking' }),
  contract({ id: 'moonshotai/kimi-k3', documentation: 'moonshotai-kimi-k3', vision: true }),
  contract({ id: 'nvidia/llama-3.1-nemotron-ultra-253b-v1', documentation: 'nvidia-llama-3_1-nemotron-ultra-253b-v1' }),
  contract({ id: 'nvidia/nemotron-3-nano-30b-a3b', documentation: 'nvidia-nemotron-3-nano-30b-a3b' }),
  contract({ id: 'nvidia/nemotron-3-super-120b-a12b', documentation: 'nvidia-nemotron-3-super-120b-a12b' }),
  contract({ id: 'nvidia/nemotron-3-ultra-550b-a55b', documentation: 'nvidia-nemotron-3-ultra-550b-a55b' }),
  contract({ id: 'nvidia/nemotron-3.5-lightning-30b-a3b', documentation: 'nvidia-nemotron-3-5-lightning-30b-a3b' }),
  contract({ id: 'nvidia/nemotron-mini-4b-instruct', documentation: 'nvidia-nemotron-mini-4b-instruct' }),
  contract({ id: 'openai/gpt-oss-20b', documentation: 'openai-gpt-oss-20b' }),
  contract({ id: 'openai/gpt-oss-120b', documentation: 'openai-gpt-oss-120b' }),
  contract({ id: 'poolside/laguna-xs-2.1', documentation: 'poolside-laguna-xs-2-1' }),
  contract({ id: 'qwen/qwen3.5-122b-a10b', documentation: 'qwen-qwen3-5-122b-a10b', vision: true }),
  contract({ id: 'stepfun-ai/step-3.5-flash', documentation: 'stepfun-ai-step-3-5-flash' }),
  contract({ id: 'stepfun-ai/step-3.7-flash', documentation: 'stepfun-ai-step-3-7-flash', vision: true }),
] as const

const contractsByModel = new Map<string, NvidiaHostedAgentModelContract>(
  NVIDIA_HOSTED_AGENT_MODEL_CONTRACTS.map(entry => [entry.id.toLowerCase(), entry]),
)

/**
 * One-shot hosted APIs with request/response adapters implemented by UR.
 *
 * These are deliberately separate from the agent contracts: they can perform
 * a useful job inside UR, but cannot become the multi-turn coding model. A
 * model is added here only after its exact public endpoint, payload, response,
 * and media constraints are implemented by NvidiaNimTaskTool.
 */
export const NVIDIA_HOSTED_TASK_MODEL_CONTRACTS = [
  {
    id: 'black-forest-labs/flux.1-schnell',
    displayName: 'FLUX.1 Schnell',
    endpoint:
      'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell',
    documentation:
      'https://docs.api.nvidia.com/nim/reference/black-forest-labs-flux_1-schnell-infer',
    taskKind: 'text-to-image',
    purpose:
      'Generate one JPEG image from a text prompt; supports NVIDIA-documented dimensions, seed, and 1-4 diffusion steps.',
    inputMediaTypes: ['text/plain'],
    outputMediaType: 'image/jpeg',
    outputExtension: '.jpg',
  },
  {
    id: 'stabilityai/stable-video-diffusion',
    displayName: 'Stable Video Diffusion',
    endpoint:
      'https://ai.api.nvidia.com/v1/genai/stabilityai/stable-video-diffusion',
    documentation:
      'https://docs.api.nvidia.com/nim/reference/stabilityai-stable-video-diffusion-infer',
    taskKind: 'image-to-video',
    purpose:
      'Generate one MP4 video from a JPEG or PNG source image; inline images must be smaller than 200 KB under NVIDIA’s hosted contract.',
    inputMediaTypes: ['image/jpeg', 'image/png'],
    outputMediaType: 'video/mp4',
    outputExtension: '.mp4',
  },
  {
    id: 'google/paligemma',
    displayName: 'PaliGemma',
    endpoint: 'https://ai.api.nvidia.com/v1/vlm/google/paligemma',
    documentation:
      'https://docs.api.nvidia.com/nim/reference/google-paligemma-infer',
    taskKind: 'image-understanding',
    purpose:
      'Analyze one image with one user prompt for captioning or visual question answering; returns text and does not continue a chat.',
    inputMediaTypes: ['image/jpeg', 'image/png'],
    outputMediaType: 'text/plain',
  },
] as const satisfies readonly NvidiaHostedTaskModelContract[]

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
 * Resolve the exact public NVIDIA endpoint attached to the model contract.
 * Custom/enterprise NIM gateways are intentionally not rewritten: their saved
 * base URL remains authoritative and is normalized by the compatible adapter.
 */
export function resolveNvidiaHostedModelEndpoint(
  baseUrl: string,
  modelId: string,
): string | undefined {
  if (!isNvidiaHostedApi(baseUrl)) return undefined
  return getNvidiaHostedAgentModelContract(modelId)?.endpoint
}

export function nvidiaHostedAgentModelIds(): string[] {
  return NVIDIA_HOSTED_AGENT_MODEL_CONTRACTS.map(entry => entry.id)
}
