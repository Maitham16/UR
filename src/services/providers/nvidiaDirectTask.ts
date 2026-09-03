import type {
  NvidiaTaskRequest,
  NvidiaTaskResult,
  NvidiaTaskRuntimeOptions,
} from './nvidiaTaskRuntime.js'
import { runNvidiaHostedTask } from './nvidiaTaskRuntime.js'

const STRING_FIELDS = {
  prompt: 'prompt',
  image_path: 'imagePath',
  input_path: 'inputPath',
  audio_path: 'audioPath',
  video_path: 'videoPath',
  reference_audio_path: 'referenceAudioPath',
  diarization_path: 'diarizationPath',
  output_path: 'outputPath',
  query: 'query',
} as const

const NUMBER_FIELDS = {
  width: 'width',
  height: 'height',
  steps: 'steps',
  seed: 'seed',
  cfg_scale: 'cfgScale',
  max_tokens: 'maxTokens',
} as const

type StringField = keyof typeof STRING_FIELDS
type NumberField = keyof typeof NUMBER_FIELDS

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (error) {
    throw new Error(
      `${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must contain a JSON object.`)
  }
  return parsed as Record<string, unknown>
}

function assignConvenienceValue(
  request: NvidiaTaskRequest,
  key: string,
  value: unknown,
): boolean {
  if (key in STRING_FIELDS && typeof value === 'string') {
    request[STRING_FIELDS[key as StringField]] = value
    return true
  }
  if (key in NUMBER_FIELDS && typeof value === 'number' && Number.isFinite(value)) {
    request[NUMBER_FIELDS[key as NumberField]] = value
    return true
  }
  if (key === 'passages' && Array.isArray(value)) {
    request.passages = value.filter((item): item is string => typeof item === 'string')
    return true
  }
  if (key === 'payload' && value && typeof value === 'object' && !Array.isArray(value)) {
    request.payload = value as Record<string, unknown>
    return true
  }
  return false
}

/**
 * Convert a prompt submitted in NVIDIA Special mode into a task request.
 * Plain text becomes the task prompt. Advanced inputs may use exact JSON or
 * newline-delimited fields such as `prompt:` and `video_path:`.
 */
export function parseNvidiaDirectTaskInput(
  model: string,
  input: string,
): NvidiaTaskRequest {
  const trimmed = input.trim()
  const request: NvidiaTaskRequest = { model }

  if (trimmed.startsWith('{')) {
    const object = parseJsonObject(trimmed, 'NVIDIA Special input')
    const recognized: string[] = []
    for (const [key, value] of Object.entries(object)) {
      if (assignConvenienceValue(request, key, value)) recognized.push(key)
    }
    if (recognized.length === 0) request.payload = object
    else {
      const exactPayload = Object.fromEntries(
        Object.entries(object).filter(([key]) => !recognized.includes(key)),
      )
      if (Object.keys(exactPayload).length > 0) {
        request.payload = { ...request.payload, ...exactPayload }
      }
    }
    return request
  }

  const lines = trimmed.split(/\r?\n/u)
  const freeText: string[] = []
  let recognizedField = false
  for (const line of lines) {
    const match = line.match(/^\s*([a-z][a-z0-9_]*)\s*[:=]\s*(.*?)\s*$/iu)
    if (!match) {
      freeText.push(line)
      continue
    }
    const key = match[1]!.toLowerCase()
    const rawValue = match[2]!
    if (key === 'payload_json') {
      request.payload = parseJsonObject(rawValue, 'payload_json')
      recognizedField = true
    } else if (key === 'passages') {
      const parsed = JSON.parse(rawValue) as unknown
      if (!Array.isArray(parsed) || !parsed.every(item => typeof item === 'string')) {
        throw new Error('passages must be a JSON array of strings.')
      }
      request.passages = parsed
      recognizedField = true
    } else if (key in STRING_FIELDS) {
      request[STRING_FIELDS[key as StringField]] = rawValue
      recognizedField = true
    } else if (key in NUMBER_FIELDS) {
      const number = Number(rawValue)
      if (!Number.isFinite(number)) throw new Error(`${key} must be a number.`)
      request[NUMBER_FIELDS[key as NumberField]] = number
      recognizedField = true
    } else {
      freeText.push(line)
    }
  }

  if (!recognizedField) request.prompt = trimmed
  else if (!request.prompt && freeText.join('\n').trim()) {
    request.prompt = freeText.join('\n').trim()
  }
  return request
}

export async function runNvidiaDirectTask(
  model: string,
  input: string,
  options: NvidiaTaskRuntimeOptions,
): Promise<NvidiaTaskResult> {
  return runNvidiaHostedTask(parseNvidiaDirectTaskInput(model, input), options)
}

export function formatNvidiaDirectTaskResult(result: NvidiaTaskResult): string {
  const lines = [
    `NVIDIA Special completed ${result.taskKind} with ${result.model}.`,
  ]
  if (result.text) lines.push(result.text)
  if (result.artifacts?.length) {
    lines.push(
      'Artifacts:',
      ...result.artifacts.map(
        artifact => `- ${artifact.label}: ${artifact.path} (${artifact.mediaType})`,
      ),
    )
  } else if (result.outputPath) {
    lines.push(`Artifact: ${result.outputPath}${result.mediaType ? ` (${result.mediaType})` : ''}`)
  }
  if (result.seed !== undefined) lines.push(`Seed: ${result.seed}`)
  return lines.join('\n')
}
