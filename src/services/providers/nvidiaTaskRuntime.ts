import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { fetchWithProviderReliability } from '../api/providerHttp.js'
import { markProviderModelUnavailable } from './providerRegistry.js'
import {
  getNvidiaHostedTaskModelContract,
  NVIDIA_HOSTED_API_BASE_URL,
  type NvidiaHostedTaskKind,
  type NvidiaHostedTaskModelContract,
} from './nvidiaHostedModels.js'

const INLINE_ASSET_LIMIT_BYTES = 200 * 1024
const NVIDIA_ASSET_ENDPOINT = 'https://api.nvcf.nvidia.com/v2/nvcf/assets'
const NVIDIA_STATUS_ENDPOINT =
  'https://api.nvcf.nvidia.com/v2/nvcf/pexec/status/'

export type NvidiaTaskFileInput = {
  jsonPointer: string
  path: string
  encoding?: 'data-url' | 'base64' | 'text' | 'asset-id' | 'asset-reference'
}

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
  query?: string
  passages?: string[]
  payload?: Record<string, unknown>
  fileInputs?: NvidiaTaskFileInput[]
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
  pollDelayMs?: number
}

type JsonObject = Record<string, unknown>
type PreparedPayload = {
  payload: JsonObject
  uploadedAssetIds: string[]
}

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

function mimeType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.webp':
      return 'image/webp'
    case '.mp4':
      return 'video/mp4'
    case '.json':
      return 'application/json'
    case '.txt':
    case '.fasta':
    case '.fa':
    case '.pdb':
    case '.csv':
      return 'text/plain'
    case '.zip':
      return 'application/zip'
    default:
      return 'application/octet-stream'
  }
}

async function localFile(path: string, cwd: string): Promise<{
  absolutePath: string
  bytes: Buffer
  mediaType: string
}> {
  const absolutePath = isAbsolute(path) ? path : resolve(cwd, path)
  const metadata = await stat(absolutePath)
  if (!metadata.isFile()) {
    throw new Error(`NVIDIA task input is not a regular file: ${absolutePath}`)
  }
  return {
    absolutePath,
    bytes: await readFile(absolutePath),
    mediaType: mimeType(absolutePath),
  }
}

async function uploadAsset(
  path: string,
  options: NvidiaTaskRuntimeOptions,
): Promise<{ id: string; mediaType: string }> {
  const file = await localFile(path, options.cwd)
  const fetchImpl = options.fetch ?? fetch
  const create = await fetchImpl(NVIDIA_ASSET_ENDPOINT, {
    method: 'POST',
    signal: options.signal,
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contentType: file.mediaType,
      description: `UR-Nexus input: ${file.absolutePath.split('/').at(-1)}`,
    }),
  })
  if (!create.ok) {
    const detail = (await create.text().catch(() => '')).trim().slice(0, 2_000)
    throw new Error(
      `NVIDIA asset creation failed (${create.status})${detail ? `: ${detail}` : ''}`,
    )
  }
  const created = jsonObject(await create.json())
  const assetId = typeof created?.assetId === 'string' ? created.assetId : ''
  const uploadUrl = typeof created?.uploadUrl === 'string' ? created.uploadUrl : ''
  if (!assetId || !uploadUrl) {
    throw new Error('NVIDIA asset creation returned no assetId or uploadUrl.')
  }
  const uploaded = await fetchImpl(uploadUrl, {
    method: 'PUT',
    signal: options.signal,
    headers: {
      'Content-Type': file.mediaType,
      'x-amz-meta-nvcf-asset-description': 'UR-Nexus model input',
    },
    body: file.bytes.buffer.slice(
      file.bytes.byteOffset,
      file.bytes.byteOffset + file.bytes.byteLength,
    ) as ArrayBuffer,
  })
  if (!uploaded.ok) {
    throw new Error(`NVIDIA asset upload failed (${uploaded.status}).`)
  }
  return { id: assetId, mediaType: file.mediaType }
}

async function deleteAssets(
  ids: string[],
  options: NvidiaTaskRuntimeOptions,
): Promise<void> {
  const fetchImpl = options.fetch ?? fetch
  await Promise.all(
    ids.map(id =>
      fetchImpl(`${NVIDIA_ASSET_ENDPOINT}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${options.apiKey}` },
      }).catch(() => undefined),
    ),
  )
}

async function fileValue(
  input: NvidiaTaskFileInput,
  options: NvidiaTaskRuntimeOptions,
  uploadedAssetIds: string[],
): Promise<unknown> {
  const encoding = input.encoding ?? 'data-url'
  if (encoding === 'asset-id' || encoding === 'asset-reference') {
    const asset = await uploadAsset(input.path, options)
    uploadedAssetIds.push(asset.id)
    return encoding === 'asset-id'
      ? asset.id
      : `data:${asset.mediaType};asset_id,${asset.id}`
  }
  const file = await localFile(input.path, options.cwd)
  if (encoding === 'text') return file.bytes.toString('utf8')
  const encoded = file.bytes.toString('base64')
  return encoding === 'base64'
    ? encoded
    : `data:${file.mediaType};base64,${encoded}`
}

function pointerParts(pointer: string): string[] {
  if (!pointer.startsWith('/')) {
    throw new Error(`file_inputs json_pointer must start with "/": ${pointer}`)
  }
  return pointer
    .slice(1)
    .split('/')
    .map(part => part.replace(/~1/gu, '/').replace(/~0/gu, '~'))
}

function setJsonPointer(root: JsonObject, pointer: string, value: unknown): void {
  const parts = pointerParts(pointer)
  if (parts.length === 0) throw new Error('file_inputs json_pointer cannot be empty.')
  let current: JsonObject | unknown[] = root
  for (const [index, part] of parts.slice(0, -1).entries()) {
    const nextPart = parts[index + 1]
    const nextIsArray = /^\d+$/u.test(nextPart)
    if (Array.isArray(current)) {
      const arrayIndex = Number(part)
      if (!Number.isInteger(arrayIndex)) {
        throw new Error(`Invalid array position in JSON pointer: ${pointer}`)
      }
      current[arrayIndex] ??= nextIsArray ? [] : {}
      current = current[arrayIndex] as JsonObject | unknown[]
    } else {
      current[part] ??= nextIsArray ? [] : {}
      current = current[part] as JsonObject | unknown[]
    }
  }
  const finalPart = parts.at(-1)!
  if (Array.isArray(current)) {
    const index = finalPart === '-' ? current.length : Number(finalPart)
    if (!Number.isInteger(index)) {
      throw new Error(`Invalid array position in JSON pointer: ${pointer}`)
    }
    current[index] = value
  } else {
    current[finalPart] = value
  }
}

function schemaProperties(contract: NvidiaHostedTaskModelContract): JsonObject {
  return jsonObject(contract.requestSchema.properties) ?? {}
}

function schemaRequired(contract: NvidiaHostedTaskModelContract): string[] {
  return Array.isArray(contract.requestSchema.required)
    ? contract.requestSchema.required.filter(
        (value): value is string => typeof value === 'string',
      )
    : []
}

function schemaErrors(
  value: unknown,
  rawSchema: unknown,
  path = '$',
): string[] {
  const schema = jsonObject(rawSchema)
  if (!schema) return []
  const alternatives = [schema.oneOf, schema.anyOf]
    .filter(Array.isArray)
    .flat() as unknown[]
  if (alternatives.length > 0) {
    const valid = alternatives.some(
      alternative => schemaErrors(value, alternative, path).length === 0,
    )
    return valid ? [] : [`${path} does not match any documented input shape`]
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    return [`${path} must be one of ${schema.enum.map(item => JSON.stringify(item)).join(', ')}`]
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  const hasType = types.some(type => typeof type === 'string')
  const matchesType = (type: unknown): boolean => {
    switch (type) {
      case 'null':
        return value === null
      case 'string':
        return typeof value === 'string'
      case 'number':
        return typeof value === 'number' && Number.isFinite(value)
      case 'integer':
        return typeof value === 'number' && Number.isInteger(value)
      case 'boolean':
        return typeof value === 'boolean'
      case 'array':
        return Array.isArray(value)
      case 'object':
        return Boolean(jsonObject(value))
      default:
        return true
    }
  }
  if (hasType && !types.some(matchesType)) {
    return [`${path} must be ${types.filter(Boolean).join(' or ')}`]
  }
  const errors: string[] = []
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${path} must be at least ${schema.minimum}`)
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${path} must be at most ${schema.maximum}`)
    }
    if (
      typeof schema.exclusiveMinimum === 'number' &&
      value <= schema.exclusiveMinimum
    ) {
      errors.push(`${path} must be greater than ${schema.exclusiveMinimum}`)
    }
    if (
      typeof schema.exclusiveMaximum === 'number' &&
      value >= schema.exclusiveMaximum
    ) {
      errors.push(`${path} must be less than ${schema.exclusiveMaximum}`)
    }
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push(`${path} is shorter than ${schema.minLength} characters`)
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push(`${path} is longer than ${schema.maxLength} characters`)
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${path} needs at least ${schema.minItems} items`)
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push(`${path} allows at most ${schema.maxItems} items`)
    }
    value.forEach((item, index) => {
      errors.push(...schemaErrors(item, schema.items, `${path}[${index}]`))
    })
  }
  const object = jsonObject(value)
  if (object) {
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === 'string')
      : []
    for (const name of required) {
      if (object[name] === undefined || object[name] === null) {
        errors.push(`${path}.${name} is required`)
      }
    }
    const properties = jsonObject(schema.properties)
    if (properties) {
      for (const [name, entry] of Object.entries(object)) {
        if (properties[name]) {
          errors.push(...schemaErrors(entry, properties[name], `${path}.${name}`))
        }
      }
    }
  }
  return errors
}

async function inlineOrAssetImage(
  imagePath: string,
  options: NvidiaTaskRuntimeOptions,
  uploadedAssetIds: string[],
): Promise<string> {
  const file = await localFile(imagePath, options.cwd)
  if (file.bytes.length < INLINE_ASSET_LIMIT_BYTES) {
    return `data:${file.mediaType};base64,${file.bytes.toString('base64')}`
  }
  const asset = await uploadAsset(imagePath, options)
  uploadedAssetIds.push(asset.id)
  return `data:${asset.mediaType};asset_id,${asset.id}`
}

function clonePayload(payload: JsonObject | undefined): JsonObject {
  return payload ? structuredClone(payload) : {}
}

function addGenerationOptions(payload: JsonObject, request: NvidiaTaskRequest): void {
  if (request.width !== undefined) payload.width = request.width
  if (request.height !== undefined) payload.height = request.height
  if (request.steps !== undefined) payload.steps = request.steps
  if (request.seed !== undefined) payload.seed = request.seed
  if (request.cfgScale !== undefined) payload.cfg_scale = request.cfgScale
  if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens
}

async function buildPayload(
  request: NvidiaTaskRequest,
  contract: NvidiaHostedTaskModelContract,
  options: NvidiaTaskRuntimeOptions,
): Promise<PreparedPayload> {
  const payload = clonePayload(request.payload)
  const properties = schemaProperties(contract)
  const uploadedAssetIds: string[] = []
  const prompt = request.prompt?.trim()
  let image: string | undefined
  if (request.imagePath) {
    image = await inlineOrAssetImage(
      request.imagePath,
      options,
      uploadedAssetIds,
    )
  }

  for (const [name, rawProperty] of Object.entries(properties)) {
    const property = jsonObject(rawProperty)
    if (payload[name] === undefined && property?.default !== undefined) {
      payload[name] = structuredClone(property.default)
    }
  }
  if (properties.model && payload.model === undefined) payload.model = contract.id
  if (properties.stream && payload.stream === undefined) payload.stream = false
  if (properties.messages && payload.messages === undefined) {
    if (image) {
      const imageKey = contract.taskKind === 'object-detection' ? 'media_url' : 'image_url'
      const messageSchema = jsonObject(properties.messages)
      const messageItem = jsonObject(messageSchema?.items)
      const messageProperties = jsonObject(messageItem?.properties)
      const contentSchema = jsonObject(messageProperties?.content)
      const mediaContent = {
        type: imageKey === 'media_url' ? 'media_url' : 'image_url',
        [imageKey]: { url: image },
      }
      payload.messages = contentSchema?.type === 'object'
        ? [{ content: mediaContent }]
        : [
            {
              role: 'user',
              content: [
                ...(prompt ? [{ type: 'text', text: prompt }] : []),
                mediaContent,
              ],
            },
          ]
    } else if (prompt) {
      payload.messages = [{ role: 'user', content: prompt }]
    }
  }
  if (properties.prompt && payload.prompt === undefined && prompt) {
    payload.prompt = prompt
  }
  if (properties.text_prompts && payload.text_prompts === undefined && prompt) {
    payload.text_prompts = [{ text: prompt, weight: 1 }]
  }
  if (properties.input && payload.input === undefined) {
    const inputSchema = jsonObject(properties.input)
    payload.input = image
      ? inputSchema?.type === 'array'
        ? [image]
        : image
      : prompt
  }
  if (properties.image && payload.image === undefined && image) payload.image = image
  if (properties.query && payload.query === undefined) {
    const query = request.query?.trim() || prompt
    payload.query = jsonObject(properties.query)?.type === 'object' && query
      ? { text: query }
      : query
  }
  if (properties.passages && payload.passages === undefined && request.passages) {
    payload.passages = request.passages.map(text => ({ text }))
  }
  if (properties.threshold && payload.threshold === undefined) payload.threshold = 0.3

  const required = schemaRequired(contract)
  const simplePromptFields = [
    'sequence',
    'smiles',
    'contigs',
    'text',
    'input_text',
  ]
  for (const field of simplePromptFields) {
    if (required.includes(field) && payload[field] === undefined && prompt) {
      payload[field] = prompt
    }
  }
  addGenerationOptions(payload, request)

  for (const fileInput of request.fileInputs ?? []) {
    setJsonPointer(
      payload,
      fileInput.jsonPointer,
      await fileValue(fileInput, options, uploadedAssetIds),
    )
  }
  const missing = required.filter(
    field => payload[field] === undefined || payload[field] === null,
  )
  if (missing.length > 0) {
    await deleteAssets(uploadedAssetIds, options)
    throw new Error(
      `NVIDIA ${contract.id} requires ${missing.join(', ')}. Supply prompt/image_path for standard inputs or payload_json/file_inputs for its exact documented schema.`,
    )
  }
  const validationErrors = schemaErrors(payload, contract.requestSchema)
  if (validationErrors.length > 0) {
    await deleteAssets(uploadedAssetIds, options)
    throw new Error(
      `NVIDIA ${contract.id} input violates its documented schema: ${validationErrors.slice(0, 8).join('; ')}`,
    )
  }
  return { payload, uploadedAssetIds }
}

function nvidiaFailureMessage(
  model: string,
  endpoint: string,
  response: Response,
  body: string,
): string {
  const unavailable =
    response.status === 404 &&
    /(?:not found for account|function[^\n]+not found|model[^\n]+not (?:found|available))/iu.test(
      body,
    )
  if (unavailable) {
    markProviderModelUnavailable(
      'nvidia-nim',
      model,
      NVIDIA_HOSTED_API_BASE_URL,
    )
    return `NVIDIA model "${model}" is not enabled for this API key. UR used its documented endpoint (${endpoint}) and removed it from this endpoint-scoped catalog until refresh.`
  }
  const detail = body
    .replace(/account\s+['"][^'"]+['"]/giu, 'account [redacted]')
    .trim()
    .slice(0, 2_000)
  return `NVIDIA request failed for ${model} at ${endpoint} (${response.status})${detail ? `: ${detail}` : ''}`
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
    failureBody: () => undefined,
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

async function saveBytes(
  bytes: Uint8Array,
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
  await writeFile(outputPath, bytes)
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

function encodedArtifact(
  body: JsonObject,
): { encoded: string; seed?: number; finishReason?: string } | undefined {
  const artifacts = Array.isArray(body.artifacts) ? body.artifacts : []
  const artifact = jsonObject(artifacts[0])
  const candidates = [artifact?.base64, body.video, body.image, body.base64]
  const encoded = candidates.find(value => typeof value === 'string' && value.length > 0)
  if (typeof encoded !== 'string') return undefined
  const comma = encoded.startsWith('data:') ? encoded.indexOf(',') : -1
  return {
    encoded: comma >= 0 ? encoded.slice(comma + 1) : encoded,
    ...(typeof artifact?.seed === 'number'
      ? { seed: artifact.seed }
      : typeof body.seed === 'number'
        ? { seed: body.seed }
        : {}),
    ...(typeof artifact?.finishReason === 'string'
      ? { finishReason: artifact.finishReason }
      : typeof body.finish_reason === 'string'
        ? { finishReason: body.finish_reason }
        : {}),
  }
}

function extensionForMediaType(mediaType: string, fallback = '.bin'): string {
  if (mediaType.includes('json')) return '.json'
  if (mediaType.includes('jpeg')) return '.jpg'
  if (mediaType.includes('png')) return '.png'
  if (mediaType.includes('mp4')) return '.mp4'
  if (mediaType.includes('zip')) return '.zip'
  if (mediaType.includes('tar')) return '.tar'
  return fallback
}

export async function runNvidiaHostedTask(
  request: NvidiaTaskRequest,
  options: NvidiaTaskRuntimeOptions,
): Promise<NvidiaTaskResult> {
  const contract = getNvidiaHostedTaskModelContract(request.model)
  if (!contract) {
    throw new Error(
      `NVIDIA model "${request.model}" has no public hosted task contract in UR's generated NVIDIA catalog.`,
    )
  }
  const apiKey = options.apiKey.trim()
  if (!apiKey) {
    throw new Error(
      'NVIDIA_API_KEY is required. Run `ur connect nvidia-nim` or set NVIDIA_API_KEY.',
    )
  }
  const prepared = await buildPayload(request, contract, options)
  const binaryResponse = contract.responseMediaTypes.find(
    type => !type.includes('json') && !type.includes('event-stream'),
  )
  const accept = contract.outputExtension && binaryResponse
    ? binaryResponse
    : contract.responseMediaTypes.includes('application/json')
      ? 'application/json'
      : contract.responseMediaTypes[0] ?? 'application/json'
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: accept,
    'Content-Type': contract.requestContentType,
  }
  try {
    const initial = await reliableFetch(
      contract.endpoint,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(prepared.payload),
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
    const responseMediaType =
      response.headers.get('content-type')?.split(';')[0]?.trim() || accept
    const now = options.now ?? Date.now
    if (!responseMediaType.includes('json')) {
      const outputPath = await saveBytes(
        new Uint8Array(await response.arrayBuffer()),
        request.outputPath,
        extensionForMediaType(
          responseMediaType,
          contract.outputExtension ?? '.bin',
        ),
        options.cwd,
        now,
      )
      return {
        model: contract.id,
        taskKind: contract.taskKind,
        purpose: contract.purpose,
        outputPath,
        mediaType: responseMediaType,
      }
    }

    const body = jsonObject(await response.json())
    if (!body) throw new Error(`NVIDIA ${contract.id} returned malformed JSON.`)
    const artifact = encodedArtifact(body)
    if (artifact && contract.outputExtension) {
      const outputPath = await saveBytes(
        Buffer.from(artifact.encoded, 'base64'),
        request.outputPath,
        contract.outputExtension,
        options.cwd,
        now,
      )
      return {
        model: contract.id,
        taskKind: contract.taskKind,
        purpose: contract.purpose,
        outputPath,
        mediaType: contract.outputMediaType,
        ...(artifact.seed !== undefined ? { seed: artifact.seed } : {}),
        ...(artifact.finishReason
          ? { finishReason: artifact.finishReason }
          : {}),
      }
    }
    const text = responseText(body)
    if (text) {
      return {
        model: contract.id,
        taskKind: contract.taskKind,
        purpose: contract.purpose,
        text,
      }
    }
    const json = JSON.stringify(body, null, 2)
    if (json.length <= 24_000) {
      return {
        model: contract.id,
        taskKind: contract.taskKind,
        purpose: contract.purpose,
        text: json,
      }
    }
    const outputPath = await saveBytes(
      Buffer.from(json),
      request.outputPath,
      '.json',
      options.cwd,
      now,
    )
    return {
      model: contract.id,
      taskKind: contract.taskKind,
      purpose: contract.purpose,
      outputPath,
      mediaType: 'application/json',
      text: `The response was ${json.length} characters and was saved as JSON.`,
    }
  } finally {
    await deleteAssets(prepared.uploadedAssetIds, options)
  }
}
