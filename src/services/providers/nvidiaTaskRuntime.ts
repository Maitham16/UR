import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { fetchWithProviderReliability } from '../api/providerHttp.js'
import { markProviderModelUnavailable } from './providerRegistry.js'
import {
  getNvidiaHostedTaskModelContract,
  NVIDIA_HOSTED_API_BASE_URL,
  type NvidiaHostedTaskKind,
} from './nvidiaHostedModels.js'

const INLINE_VIDEO_IMAGE_LIMIT_BYTES = 200 * 1024
const NVIDIA_STATUS_ENDPOINT =
  'https://api.nvcf.nvidia.com/v2/nvcf/pexec/status/'
const FLUX_DIMENSIONS = new Set([
  768, 832, 896, 960, 1024, 1088, 1152, 1216, 1280, 1344,
])

export type NvidiaTaskRequest = {
  model: string
  prompt?: string
  imagePath?: string
  outputPath?: string
  width?: number
  height?: number
  steps?: number
  seed?: number
  cfgScale?: number
  maxTokens?: number
}

export type NvidiaTaskResult = {
  model: string
  taskKind: NvidiaHostedTaskKind
  purpose: string
  outputPath?: string
  mediaType?: string
  text?: string
  seed?: number
  finishReason?: string
}

export type NvidiaTaskRuntimeOptions = {
  apiKey: string
  cwd: string
  signal?: AbortSignal
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  now?: () => number
  /** Test/embedding override; production uses a modest asynchronous poll delay. */
  pollDelayMs?: number
}

type JsonObject = Record<string, unknown>

function jsonObject(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined
}

function requiredText(value: string | undefined, name: string): string {
  const normalized = value?.trim()
  if (!normalized) throw new Error(`${name} is required for this NVIDIA task.`)
  return normalized
}

function imageMimeType(path: string): 'image/jpeg' | 'image/png' {
  const extension = extname(path).toLowerCase()
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.png') return 'image/png'
  throw new Error('NVIDIA task images must be JPEG or PNG files.')
}

async function imageDataUrl(
  imagePath: string | undefined,
  cwd: string,
  taskKind: NvidiaHostedTaskKind,
): Promise<string> {
  const requestedPath = requiredText(imagePath, 'image_path')
  const absolutePath = isAbsolute(requestedPath)
    ? requestedPath
    : resolve(cwd, requestedPath)
  const mimeType = imageMimeType(absolutePath)
  const metadata = await stat(absolutePath)
  if (!metadata.isFile()) {
    throw new Error(`NVIDIA task image is not a regular file: ${absolutePath}`)
  }
  if (
    taskKind === 'image-to-video' &&
    metadata.size >= INLINE_VIDEO_IMAGE_LIMIT_BYTES
  ) {
    throw new Error(
      `Stable Video Diffusion accepts inline images smaller than 200 KB; ${absolutePath} is ${metadata.size} bytes. Resize or compress it first.`,
    )
  }
  const bytes = await readFile(absolutePath)
  return `data:${mimeType};base64,${bytes.toString('base64')}`
}

function fluxDimension(value: number | undefined, name: string): number {
  const dimension = value ?? 1024
  if (!Number.isInteger(dimension) || !FLUX_DIMENSIONS.has(dimension)) {
    throw new Error(
      `${name} must be one of ${[...FLUX_DIMENSIONS].join(', ')} for FLUX.1 Schnell.`,
    )
  }
  return dimension
}

function unsignedSeed(value: number | undefined): number {
  const seed = value ?? 0
  if (!Number.isInteger(seed) || seed < 0 || seed >= 4_294_967_296) {
    throw new Error('seed must be an integer from 0 through 4294967295.')
  }
  return seed
}

async function buildPayload(
  request: NvidiaTaskRequest,
  cwd: string,
  taskKind: NvidiaHostedTaskKind,
): Promise<JsonObject> {
  if (taskKind === 'text-to-image') {
    const steps = request.steps ?? 4
    if (!Number.isInteger(steps) || steps < 1 || steps > 4) {
      throw new Error('steps must be an integer from 1 through 4 for FLUX.1 Schnell.')
    }
    return {
      prompt: requiredText(request.prompt, 'prompt'),
      width: fluxDimension(request.width, 'width'),
      height: fluxDimension(request.height, 'height'),
      cfg_scale: 0,
      mode: 'base',
      samples: 1,
      seed: unsignedSeed(request.seed),
      steps,
    }
  }

  const image = await imageDataUrl(request.imagePath, cwd, taskKind)
  if (taskKind === 'image-to-video') {
    const cfgScale = request.cfgScale ?? 1.8
    if (!Number.isFinite(cfgScale) || cfgScale <= 1 || cfgScale > 9) {
      throw new Error('cfg_scale must be greater than 1 and at most 9.')
    }
    return {
      image,
      seed: unsignedSeed(request.seed),
      cfg_scale: cfgScale,
      motion_bucket_id: 127,
    }
  }

  const maxTokens = request.maxTokens ?? 1024
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 1024) {
    throw new Error('max_tokens must be an integer from 1 through 1024 for PaliGemma.')
  }
  return {
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: requiredText(request.prompt, 'prompt') },
          { type: 'image_url', image_url: { url: image } },
        ],
      },
    ],
    max_tokens: maxTokens,
    stream: false,
  }
}

function nvidiaFailureMessage(
  model: string,
  endpoint: string,
  response: Response,
  body: string,
): string {
  if (
    response.status === 404 &&
    /function\s+['"][^'"]+['"]\s*:\s*not found for account\s+['"][^'"]+['"]/iu.test(body)
  ) {
    markProviderModelUnavailable(
      'nvidia-nim',
      model,
      NVIDIA_HOSTED_API_BASE_URL,
    )
    return `NVIDIA one-shot model "${model}" is unavailable to this account. Refresh the NVIDIA catalog or choose another implemented task model.`
  }
  const detail = body.trim().slice(0, 2_000)
  return `NVIDIA one-shot request failed for ${model} at ${endpoint} (${response.status})${detail ? `: ${detail}` : ''}`
}

async function reliableFetch(
  endpoint: string,
  init: RequestInit,
  model: string,
  options: NvidiaTaskRuntimeOptions,
): Promise<Response> {
  return fetchWithProviderReliability(endpoint, init, {
    signal: options.signal,
    fetch: options.fetch,
    failureMessage: (response, body) =>
      nvidiaFailureMessage(model, endpoint, response, body),
    failureBody: (response, body) =>
      response.status === 404 &&
      /function\s+['"][^'"]+['"]\s*:\s*not found for account\s+['"][^'"]+['"]/iu.test(body)
        ? undefined
        : body,
  })
}

function abortableDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveDelay, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason ?? new Error('NVIDIA task cancelled.'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolveDelay()
    }, delayMs)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function awaitNvidiaResult(
  initial: Response,
  model: string,
  headers: Record<string, string>,
  options: NvidiaTaskRuntimeOptions,
): Promise<Response> {
  let response = initial
  while (response.status === 202) {
    const requestId = response.headers.get('nvcf-reqid')
    const location = response.headers.get('location')
    const statusEndpoint = location
      ? new URL(location, NVIDIA_STATUS_ENDPOINT).toString()
      : requestId
        ? `${NVIDIA_STATUS_ENDPOINT}${encodeURIComponent(requestId)}`
        : undefined
    if (!statusEndpoint) {
      throw new Error(
        `NVIDIA accepted ${model} asynchronously but returned neither Location nor NVCF-REQID for status polling.`,
      )
    }
    await abortableDelay(options.pollDelayMs ?? 750, options.signal)
    response = await reliableFetch(
      statusEndpoint,
      { method: 'GET', headers },
      model,
      options,
    )
  }
  return response
}

function defaultOutputPath(
  cwd: string,
  extension: string,
  now: () => number,
): string {
  return join(cwd, '.ur', 'artifacts', 'nvidia', `${now()}${extension}`)
}

async function saveArtifact(
  encoded: string,
  requestedPath: string | undefined,
  extension: string,
  cwd: string,
  now: () => number,
): Promise<string> {
  const outputPath = requestedPath
    ? isAbsolute(requestedPath)
      ? requestedPath
      : resolve(cwd, requestedPath)
    : defaultOutputPath(cwd, extension, now)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, Buffer.from(encoded, 'base64'))
  return outputPath
}

function responseText(body: JsonObject): string | undefined {
  const choices = Array.isArray(body.choices) ? body.choices : []
  const first = jsonObject(choices[0])
  const message = jsonObject(first?.message)
  const content = message?.content
  if (typeof content === 'string' && content.trim()) return content.trim()
  return undefined
}

export async function runNvidiaHostedTask(
  request: NvidiaTaskRequest,
  options: NvidiaTaskRuntimeOptions,
): Promise<NvidiaTaskResult> {
  const contract = getNvidiaHostedTaskModelContract(request.model)
  if (!contract) {
    throw new Error(
      `NVIDIA model "${request.model}" has no implemented one-shot UR adapter and is not selectable as a task model.`,
    )
  }
  const apiKey = options.apiKey.trim()
  if (!apiKey) {
    throw new Error(
      'NVIDIA_API_KEY is required. Run `ur connect nvidia-nim` or set NVIDIA_API_KEY.',
    )
  }
  const payload = await buildPayload(request, options.cwd, contract.taskKind)
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
  const initial = await reliableFetch(
    contract.endpoint,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    },
    contract.id,
    options,
  )
  const response = await awaitNvidiaResult(
    initial,
    contract.id,
    headers,
    options,
  )
  const body = jsonObject(await response.json())
  if (!body) throw new Error(`NVIDIA ${contract.id} returned malformed JSON.`)

  if (contract.taskKind === 'text-to-image') {
    const artifacts = Array.isArray(body.artifacts) ? body.artifacts : []
    const artifact = jsonObject(artifacts[0])
    const encoded = artifact?.base64
    if (typeof encoded !== 'string' || !encoded) {
      throw new Error(`NVIDIA ${contract.id} returned no image artifact.`)
    }
    const outputPath = await saveArtifact(
      encoded,
      request.outputPath,
      contract.outputExtension ?? '.jpg',
      options.cwd,
      options.now ?? Date.now,
    )
    return {
      model: contract.id,
      taskKind: contract.taskKind,
      purpose: contract.purpose,
      outputPath,
      mediaType: contract.outputMediaType,
      ...(typeof artifact.seed === 'number' ? { seed: artifact.seed } : {}),
      ...(typeof artifact.finishReason === 'string'
        ? { finishReason: artifact.finishReason }
        : {}),
    }
  }

  if (contract.taskKind === 'image-to-video') {
    const encoded = body.video
    if (typeof encoded !== 'string' || !encoded) {
      throw new Error(`NVIDIA ${contract.id} returned no video artifact.`)
    }
    const outputPath = await saveArtifact(
      encoded,
      request.outputPath,
      contract.outputExtension ?? '.mp4',
      options.cwd,
      options.now ?? Date.now,
    )
    return {
      model: contract.id,
      taskKind: contract.taskKind,
      purpose: contract.purpose,
      outputPath,
      mediaType: contract.outputMediaType,
      ...(typeof body.seed === 'number' ? { seed: body.seed } : {}),
      ...(typeof body.finish_reason === 'string'
        ? { finishReason: body.finish_reason }
        : {}),
    }
  }

  const text = responseText(body)
  if (!text) throw new Error(`NVIDIA ${contract.id} returned no analysis text.`)
  return {
    model: contract.id,
    taskKind: contract.taskKind,
    purpose: contract.purpose,
    text,
  }
}
