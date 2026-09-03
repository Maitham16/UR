import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { fetchWithProviderReliability } from '../api/providerHttp.js'
import {
  getNvidiaHostedTaskModelContract,
  type NvidiaHostedTaskKind,
  type NvidiaHostedTaskModelContract,
} from './nvidiaHostedModels.js'
import { runNvidiaGrpcTask } from './nvidiaGrpcRuntime.js'

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
  inputPath?: string
  audioPath?: string
  videoPath?: string
  referenceAudioPath?: string
  diarizationPath?: string
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
  artifacts?: NvidiaTaskArtifact[]
}

export type NvidiaTaskArtifact = {
  label: string
  path: string
  mediaType: string
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
    case '.wav':
      return 'audio/wav'
    case '.mp3':
      return 'audio/mpeg'
    case '.ogg':
    case '.opus':
      return 'audio/ogg'
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
  if (Object.hasOwn(schema, 'const') && value !== schema.const) {
    return [`${path} must equal ${JSON.stringify(schema.const)}`]
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
    if (
      typeof schema.multipleOf === 'number' &&
      schema.multipleOf > 0 &&
      Math.abs(value / schema.multipleOf - Math.round(value / schema.multipleOf)) >
        Number.EPSILON * 10
    ) {
      errors.push(`${path} must be a multiple of ${schema.multipleOf}`)
    }
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push(`${path} is shorter than ${schema.minLength} characters`)
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push(`${path} is longer than ${schema.maxLength} characters`)
    }
    if (typeof schema.pattern === 'string') {
      try {
        if (!new RegExp(schema.pattern, 'u').test(value)) {
          errors.push(`${path} does not match the documented pattern`)
        }
      } catch {
        // Preserve compatibility if an upstream JSON Schema uses a regular
        // expression feature that JavaScript does not implement.
      }
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
        } else if (schema.additionalProperties === false) {
          errors.push(`${path}.${name} is not part of NVIDIA's documented schema`)
        }
      }
    }
  }
  return errors
}

async function inlineOrAssetMedia(
  path: string,
  options: NvidiaTaskRuntimeOptions,
  uploadedAssetIds: string[],
): Promise<string> {
  const file = await localFile(path, options.cwd)
  if (file.bytes.length < INLINE_ASSET_LIMIT_BYTES) {
    return `data:${file.mediaType};base64,${file.bytes.toString('base64')}`
  }
  const asset = await uploadAsset(path, options)
  uploadedAssetIds.push(asset.id)
  return `data:${asset.mediaType};asset_id,${asset.id}`
}

function clonePayload(payload: JsonObject | undefined): JsonObject {
  return payload ? structuredClone(payload) : {}
}

function addGenerationOptions(
  payload: JsonObject,
  request: NvidiaTaskRequest,
  properties: JsonObject,
): void {
  if (request.width !== undefined) payload.width = request.width
  if (request.height !== undefined) payload.height = request.height
  if (request.steps !== undefined) payload.steps = request.steps
  if (request.seed !== undefined) payload.seed = request.seed
  if (request.cfgScale !== undefined) {
    if (properties.cfg_scale) payload.cfg_scale = request.cfgScale
    else if (properties.guidance_scale) payload.guidance_scale = request.cfgScale
    else payload.cfg_scale = request.cfgScale
  }
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
  const genericPath = request.inputPath?.trim()
  const genericExtension = genericPath ? extname(genericPath).toLowerCase() : ''
  const imagePath =
    request.imagePath ??
    (/^\.(?:jpe?g|png|webp)$/u.test(genericExtension) ? genericPath : undefined)
  const videoPath =
    request.videoPath ?? (genericExtension === '.mp4' ? genericPath : undefined)
  const audioPath =
    request.audioPath ??
    (/^\.(?:wav|mp3|ogg|opus)$/u.test(genericExtension) ? genericPath : undefined)
  let image: string | undefined
  let video: string | undefined
  let audio: string | undefined
  if (imagePath) {
    image = await inlineOrAssetMedia(imagePath, options, uploadedAssetIds)
  }
  if (videoPath) {
    video = await inlineOrAssetMedia(videoPath, options, uploadedAssetIds)
  }
  if (audioPath) {
    audio = await inlineOrAssetMedia(audioPath, options, uploadedAssetIds)
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
    const content = [
      ...(prompt ? [{ type: 'text', text: prompt }] : []),
      ...(image ? [{ type: 'image_url', image_url: { url: image } }] : []),
      ...(video ? [{ type: 'video_url', video_url: { url: video } }] : []),
      ...(audio ? [{ type: 'audio_url', audio_url: { url: audio } }] : []),
    ]
    if (content.some(part => part.type !== 'text')) {
      payload.messages = [{ role: 'user', content }]
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
  if (properties.video && payload.video === undefined && video) payload.video = video
  if (properties.audio && payload.audio === undefined && audio) payload.audio = audio
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
    'scene_id',
  ]
  for (const field of simplePromptFields) {
    if (required.includes(field) && payload[field] === undefined && prompt) {
      payload[field] = prompt
    }
  }
  addGenerationOptions(payload, request, properties)

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
    const convenienceFields = missing.map(field => {
      if (field === 'image') return 'image_path'
      if (field === 'video') return 'video_path'
      if (field === 'audio') return 'audio_path'
      return field
    })
    throw new Error(
      `NVIDIA ${contract.id} requires ${missing.join(', ')}. Submit the missing input as ${convenienceFields.join(', ')} fields on separate lines, or provide exact JSON matching the model's documented schema.`,
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
    return `NVIDIA Special model "${model}" is not enabled for this API key. UR kept it in the catalog and used its documented endpoint (${endpoint}); NVIDIA rejected this invocation for the current account.`
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

type EncodedArtifact = {
  label: string
  encoded: string
  mediaType: string
  seed?: number
  finishReason?: string
}

function stripDataUrl(value: string): { encoded: string; mediaType?: string } {
  if (!value.startsWith('data:')) return { encoded: value }
  const comma = value.indexOf(',')
  if (comma < 0) return { encoded: value }
  const metadata = value.slice(5, comma)
  return {
    encoded: value.slice(comma + 1),
    ...(metadata.split(';')[0] ? { mediaType: metadata.split(';')[0] } : {}),
  }
}

function encodedArtifacts(
  body: JsonObject,
  fallbackMediaType: string,
): EncodedArtifact[] {
  const output: EncodedArtifact[] = []
  const common = {
    ...(typeof body.seed === 'number' ? { seed: body.seed } : {}),
    ...(typeof body.finish_reason === 'string'
      ? { finishReason: body.finish_reason }
      : {}),
  }
  const add = (
    label: string,
    value: unknown,
    mediaType: string,
    metadata: JsonObject | undefined = undefined,
  ) => {
    if (typeof value !== 'string' || value.length === 0) return
    const normalized = stripDataUrl(value)
    output.push({
      label,
      encoded: normalized.encoded,
      mediaType: normalized.mediaType ?? mediaType,
      ...common,
      ...(typeof metadata?.seed === 'number' ? { seed: metadata.seed } : {}),
      ...(typeof metadata?.finishReason === 'string'
        ? { finishReason: metadata.finishReason }
        : {}),
    })
  }

  for (const [index, value] of (Array.isArray(body.artifacts)
    ? body.artifacts
    : []).entries()) {
    const artifact = jsonObject(value)
    add(
      typeof artifact?.label === 'string' ? artifact.label : `artifact-${index + 1}`,
      artifact?.base64,
      typeof artifact?.mime_type === 'string'
        ? artifact.mime_type
        : fallbackMediaType,
      artifact,
    )
  }
  add('video', body.b64_video, 'video/mp4')
  add('image', body.b64_image, 'image/png')
  add('audio', body.b64_audio, 'audio/wav')
  add('artifact', body.base64, fallbackMediaType)

  for (const [field, defaultMediaType] of [
    ['camera_video', 'video/mp4'],
    ['bev_video', 'video/mp4'],
    ['bbox_video', 'video/mp4'],
    ['map_video', 'video/mp4'],
  ] as const) {
    const nested = jsonObject(body[field])
    add(
      field.replace(/_/gu, '-'),
      nested?.data ?? nested?.file,
      typeof nested?.mime_type === 'string'
        ? nested.mime_type
        : defaultMediaType,
    )
  }
  return output
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

function requestedArtifactPath(
  requestedPath: string | undefined,
  label: string,
  index: number,
  total: number,
  mediaType: string,
): string | undefined {
  if (!requestedPath) return undefined
  if (total === 1 || index === 0) return requestedPath
  const extension = extname(requestedPath) || extensionForMediaType(mediaType)
  const filename = basename(requestedPath, extname(requestedPath))
  return join(dirname(requestedPath), `${filename}-${label}${extension}`)
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
  if (!contract.executable || contract.transport === 'unpublished') {
    throw new Error(
      `NVIDIA lists ${contract.id} as a Free Endpoint but has not published an inference request/response contract for it. UR kept the model visible and will not invent a transport. See ${contract.documentation}`,
    )
  }
  const apiKey = options.apiKey.trim()
  if (!apiKey) {
    throw new Error(
      'NVIDIA_API_KEY is required. Run `ur connect nvidia-special` (or `ur connect nvidia-nim`) or set NVIDIA_API_KEY.',
    )
  }
  if (contract.transport === 'grpc') {
    const result = await runNvidiaGrpcTask(
      contract,
      {
        prompt: request.prompt,
        inputPath: request.inputPath,
        audioPath: request.audioPath,
        videoPath: request.videoPath,
        referenceAudioPath: request.referenceAudioPath,
        diarizationPath: request.diarizationPath,
        outputPath: request.outputPath,
        payload: request.payload,
      },
      {
        apiKey,
        cwd: options.cwd,
        signal: options.signal,
        now: options.now,
      },
    )
    return {
      model: contract.id,
      taskKind: contract.taskKind,
      purpose: contract.purpose,
      ...result,
    }
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
        method: contract.method,
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
    const encoded = encodedArtifacts(body, contract.outputMediaType)
    if (encoded.length > 0) {
      const artifacts = await Promise.all(
        encoded.map(async (artifact, index) => ({
          label: artifact.label,
          path: await saveBytes(
            Buffer.from(artifact.encoded, 'base64'),
            requestedArtifactPath(
              request.outputPath,
              artifact.label,
              index,
              encoded.length,
              artifact.mediaType,
            ),
            extensionForMediaType(
              artifact.mediaType,
              contract.outputExtension ?? '.bin',
            ),
            options.cwd,
            () => now() + index,
          ),
          mediaType: artifact.mediaType,
        })),
      )
      const first = encoded[0]
      return {
        model: contract.id,
        taskKind: contract.taskKind,
        purpose: contract.purpose,
        outputPath: artifacts[0]?.path,
        mediaType: artifacts[0]?.mediaType,
        artifacts,
        ...(first?.seed !== undefined ? { seed: first.seed } : {}),
        ...(first?.finishReason
          ? { finishReason: first.finishReason }
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
