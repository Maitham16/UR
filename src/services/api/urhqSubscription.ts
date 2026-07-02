/**
 * Subscription CLI provider client.
 * Spawns the official CLI (Codex, Claude Code, Gemini, Antigravity) in
 * non-interactive mode, feeds the prompt, and maps stdout into a response.
 * This is an external vendor CLI boundary: UR does not expose native tool
 * calling, native streaming, or UR Bash/File execution semantics inside the CLI.
 * It never fabricates output: a non-zero exit or empty stdout fails clearly.
 */

import { spawn } from 'node:child_process'
import { randomUUID } from 'crypto'
import { SUBSCRIPTION_CLI_PROVIDER_BOUNDARY } from '../providers/providerRegistry.js'
import { ProviderCapabilityError, type ProviderMessageClient } from './providerClient.js'
import { createBufferedMessageReplayStream } from './streamingAdapters.js'

export type SubscriptionCliResult = {
  code: number
  stdout: string
  stderr: string
}

export type SubscriptionCliRunner = (
  command: string,
  args: string[],
  options: { input?: string; signal?: AbortSignal; timeoutMs?: number; stdinMode?: SubscriptionCliStdinMode },
) => Promise<SubscriptionCliResult>

export type SubscriptionCliStdinMode = 'ignore' | 'inherit' | 'pipe'

type CliSpec = {
  args: (model: string, prompt: string) => string[]
  stdinMode?: SubscriptionCliStdinMode
}

type MessageContentBlock =
  | string
  | { type: 'text'; text?: string }
  | { type: 'tool_result'; content?: MessageContent }
  | Record<string, unknown>

type MessageContent = string | MessageContentBlock[]

type SubscriptionMessageParam = {
  role: string
  content: MessageContent
}

type SubscriptionRequestParams = {
  model?: string
  system?: MessageContent
  messages?: SubscriptionMessageParam[]
  stream?: boolean
  headers?: Record<string, string>
}

type SubscriptionResponse = {
  id: string
  type: 'message'
  role: 'assistant'
  model?: string
  content: Array<{ type: 'text'; text: string }>
  stop_reason: 'end_turn'
  stop_sequence: null
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens: 0
    cache_read_input_tokens: 0
  }
}

type ParsedCliObject = Record<string, unknown> & {
  is_error?: unknown
  api_error_status?: unknown
  result?: unknown
  error?: unknown
  message?: unknown
  response?: unknown
  text?: unknown
  output?: unknown
  content?: unknown
  choices?: unknown
}

// Non-interactive invocation per official CLI. The prompt is passed as an
// argument; the model flag maps the scoped model id to the CLI's own name.
const CLI_SPECS: Record<string, CliSpec> = {
  // Codex exec treats any non-TTY stdin (including /dev/null or a closed pipe)
  // as "additional input from stdin". Inherit terminal stdin so the prompt
  // argument remains the only prompt content in interactive UR sessions.
  'codex-cli': { args: (model, prompt) => ['exec', '--model', model, prompt], stdinMode: 'inherit' },
  'claude-code-cli': {
    args: (model, prompt) => ['-p', prompt, '--model', model, '--output-format', 'json'],
  },
  'gemini-cli': { args: (model, prompt) => ['-p', prompt, '-m', model] },
  'antigravity-cli': { args: (model, prompt) => ['-p', prompt, '--model', model] },
}

export function createURHQSubscriptionClient(
  providerId: string,
  options: {
    commandPath: string
    maxRetries: number
    model?: string
    runner?: SubscriptionCliRunner
    timeoutMs?: number
  },
): ProviderMessageClient {
  const spec = CLI_SPECS[providerId]
  if (!spec) {
    throw new Error(`No subscription CLI dispatch is configured for provider "${providerId}".`)
  }
  const run = options.runner ?? defaultRunner

  async function doRequest(
    params: SubscriptionRequestParams,
    requestOptions?: { signal?: AbortSignal },
  ): Promise<{
    data: SubscriptionResponse
    response: { headers: Record<string, string> }
  }> {
    const model = cliModelName(params.model ?? options.model ?? '')
    if (!model) {
      throw new Error(`Provider "${providerId}" requires a model to dispatch to its CLI.`)
    }
    const prompt = messagesToPrompt(params, providerId)
    const result = await run(options.commandPath, spec.args(model, prompt), {
      stdinMode: spec.stdinMode,
      signal: requestOptions?.signal,
      timeoutMs: options.timeoutMs ?? 120_000,
    })
    const failure = formatCliFailure(providerId, options.commandPath, model, result)
    if (failure) {
      throw new Error(failure)
    }
    const text = extractText(result.stdout)
    if (!text) {
      throw new Error(
        `Subscription CLI "${options.commandPath}" for ${providerId} produced no output. Boundary: ${SUBSCRIPTION_CLI_PROVIDER_BOUNDARY}`,
      )
    }
    const data: SubscriptionResponse = {
      id: `${providerId}-${randomUUID()}`,
      type: 'message',
      role: 'assistant',
      model: params.model ?? options.model,
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: estimateTokens(prompt),
        output_tokens: estimateTokens(text),
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    }
    const clientRequestId = params?.headers?.['x-client-request-id']
    return {
      data,
      response: { headers: clientRequestId ? { 'x-client-request-id': clientRequestId } : {} },
    }
  }

  const messagesAPI = {
    create(params: SubscriptionRequestParams, requestOptions?: { signal?: AbortSignal }) {
      if (params.stream) {
        const pending = doRequest(params, requestOptions)
        return {
          async withResponse() {
            const { response, data } = await pending
            return {
              data: createBufferedMessageReplayStream(data),
              response,
              request_id: data.id,
            }
          },
        }
      }
      return doRequest(params, requestOptions).then(({ response, data }) => ({
        ...data,
        withResponse: () => ({ data, response, request_id: data.id }),
      }))
    },
    async countTokens(params: SubscriptionRequestParams) {
      return { input_tokens: estimateTokens(messagesToPrompt(params, providerId)) }
    },
  }

  return { beta: { messages: messagesAPI } }
}

export function getSubscriptionCliStdinMode(
  input?: string,
  mode?: SubscriptionCliStdinMode,
): SubscriptionCliStdinMode {
  if (mode) return mode
  return input === undefined ? 'ignore' : 'pipe'
}

const defaultRunner: SubscriptionCliRunner = (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: [getSubscriptionCliStdinMode(options.input, options.stdinMode), 'pipe', 'pipe'],
      signal: options.signal,
    })
    let stdout = ''
    let stderr = ''
    const timer = options.timeoutMs
      ? setTimeout(() => child.kill('SIGKILL'), options.timeoutMs)
      : undefined
    child.stdout?.on('data', chunk => {
      stdout += chunk
    })
    child.stderr?.on('data', chunk => {
      stderr += chunk
    })
    child.on('error', error => {
      if (timer) clearTimeout(timer)
      reject(error)
    })
    child.on('close', code => {
      if (timer) clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
    if (options.input !== undefined && child.stdin) {
      child.stdin?.write(options.input)
      child.stdin?.end()
    }
  })

function cliModelName(model: string): string {
  const slash = model.indexOf('/')
  return slash >= 0 ? model.slice(slash + 1) : model
}

function formatCliFailure(
  providerId: string,
  commandPath: string,
  model: string,
  result: SubscriptionCliResult,
): string | null {
  const parsed = parseCliJsonFailure(result.stdout)
  if (result.code === 0 && !parsed?.isError) {
    return null
  }

  const rawStderr = result.stderr.trim()
  const rawStdout = result.stdout.trim()
  const summary =
    summarizeKnownCliFailure(rawStderr) ??
    parsed?.message ??
    summarizeKnownCliFailure(rawStdout) ??
    firstUsefulLine(rawStderr) ??
    firstUsefulLine(rawStdout) ??
    'no output'
  const status = parsed?.status ? ` (status ${parsed.status})` : ''
  const exit = result.code === 0 ? 'reported an error' : `exited ${result.code}`
  return `Subscription CLI "${commandPath}" for ${providerId} ${exit}${status} with model "${model}": ${summary}. Suggested action: run /model and choose a valid model for ${providerId}, or run: ur provider doctor ${providerId}. UR did not fall back to another provider. Boundary: ${SUBSCRIPTION_CLI_PROVIDER_BOUNDARY}`
}

function parseCliJsonFailure(stdout: string): { isError: boolean; status?: string | number; message?: string } | null {
  const raw = stdout.trim()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!isParsedCliObject(parsed)) return null
    const entry = parsed
    const isError = entry.is_error === true || entry.error !== undefined
    if (!isError) return null
    const message = [entry.result, entry.message, entry.error, entry.response]
      .find(value => typeof value === 'string' && value.trim()) as string | undefined
    const status =
      typeof entry.api_error_status === 'number' || typeof entry.api_error_status === 'string'
        ? entry.api_error_status
        : undefined
    return { isError, status, message: message?.trim() }
  } catch {
    return null
  }
}

function summarizeKnownCliFailure(text: string): string | null {
  if (!text) return null
  const reasonMessage = text.match(/reasonMessage:\s*'([^']+)'/)?.[1]
  if (reasonMessage) return reasonMessage
  if (/IneligibleTierError|UNSUPPORTED_CLIENT/i.test(text)) {
    return 'The selected Gemini CLI account/client is not eligible for this Gemini Code Assist runtime.'
  }
  if (/There's an issue with the selected model/i.test(text)) {
    return firstUsefulLine(text)
  }
  return null
}

function firstUsefulLine(text: string): string | null {
  const line = text
    .split(/\r?\n/)
    .map(value => value.trim())
    .find(value => value && !value.startsWith('at ') && !value.startsWith('file://'))
  return line ? truncate(line, 800) : null
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function extractText(stdout: string): string {
  const raw = stdout.trim()
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'string') return parsed
    if (!isParsedCliObject(parsed)) return raw
    const candidate = cliTextCandidate(parsed)
    if (typeof candidate === 'string' && candidate.trim()) return candidate
  } catch {
    // Not JSON: fall through to raw stdout.
  }
  return raw
}

function isParsedCliObject(value: unknown): value is ParsedCliObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function cliTextCandidate(parsed: ParsedCliObject): unknown {
  return (
    parsed.result ??
    parsed.response ??
    parsed.text ??
    parsed.output ??
    nestedMessageContent(parsed.message) ??
    firstChoiceContent(parsed.choices) ??
    contentArrayText(parsed.content)
  )
}

function nestedMessageContent(message: unknown): unknown {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return undefined
  }
  return (message as { content?: unknown }).content
}

function firstChoiceContent(choices: unknown): unknown {
  if (!Array.isArray(choices)) return undefined
  const first = choices[0]
  if (!first || typeof first !== 'object' || Array.isArray(first)) {
    return undefined
  }
  const message = (first as { message?: unknown }).message
  return nestedMessageContent(message)
}

function contentArrayText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined
  return content
    .map(block =>
      block && typeof block === 'object' && !Array.isArray(block)
        ? ((block as { text?: unknown }).text ?? '')
        : '',
    )
    .join('')
}

function messagesToPrompt(params: SubscriptionRequestParams, providerId: string): string {
  const parts: string[] = []
  const system = systemToText(params.system, providerId)
  if (system) parts.push(system)
  const messages = params.messages ?? []
  const label = messages.length > 1
  for (const message of messages) {
    const text = contentToText(message.content, providerId)
    if (!text) continue
    parts.push(label ? `${capitalize(message.role)}: ${text}` : text)
  }
  return parts.join('\n\n')
}

function systemToText(system: MessageContent | undefined, providerId: string): string {
  if (!system) return ''
  if (typeof system === 'string') return system
  if (Array.isArray(system)) {
    return system
      .map(block => {
        assertNoImageBlock(block, providerId, 'the system prompt')
        return isTextBlock(block) ? (block.text ?? '') : typeof block === 'string' ? block : ''
      })
      .join('\n\n')
  }
  return ''
}

function contentToText(content: MessageContent | undefined, providerId: string): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(block => {
      if (typeof block === 'string') return block
      assertNoImageBlock(block, providerId, 'message content')
      if (isTextBlock(block)) return block.text ?? ''
      if (isToolResultBlock(block)) return contentToText(block.content, providerId)
      return ''
    })
    .join('\n')
}

function isTextBlock(block: MessageContentBlock): block is { type: 'text'; text?: string } {
  return Boolean(block && typeof block === 'object' && !Array.isArray(block) && block.type === 'text')
}

function isToolResultBlock(
  block: MessageContentBlock,
): block is { type: 'tool_result'; content?: MessageContent } {
  return Boolean(
    block &&
      typeof block === 'object' &&
      !Array.isArray(block) &&
      block.type === 'tool_result',
  )
}

function isImageBlock(block: MessageContentBlock): block is Record<string, unknown> & { type: 'image' } {
  return Boolean(block && typeof block === 'object' && !Array.isArray(block) && block.type === 'image')
}

// External vendor CLIs receive a flattened text prompt — no channel for image bytes.
function assertNoImageBlock(block: MessageContentBlock, providerId: string, context: string): void {
  if (!isImageBlock(block)) return
  throw new ProviderCapabilityError(
    `Subscription CLI provider "${providerId}" does not support image/multimodal input in ${context}. ` +
      `Switch to a UR-native multimodal API or local provider (OpenAI, Anthropic, Gemini, or an OpenAI-compatible local endpoint) to send images. ` +
      `Boundary: ${SUBSCRIPTION_CLI_PROVIDER_BOUNDARY}`,
    { providerId, capability: 'multimodal_input', context },
  )
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value
}

function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4)
}
