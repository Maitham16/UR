// @ts-nocheck
/**
 * Subscription CLI provider client.
 * Spawns the official CLI (Codex, Claude Code, Gemini, Antigravity) in
 * non-interactive mode, feeds the prompt, and maps stdout into a response.
 * It never fabricates output: a non-zero exit or empty stdout fails clearly.
 */

import type URHQ from '@urhq-ai/sdk'
import { spawn } from 'node:child_process'
import { randomUUID } from 'crypto'
import { createOneShotMessageStream } from './streamingAdapters.js'

export type SubscriptionCliResult = {
  code: number
  stdout: string
  stderr: string
}

export type SubscriptionCliRunner = (
  command: string,
  args: string[],
  options: { input?: string; signal?: AbortSignal; timeoutMs?: number },
) => Promise<SubscriptionCliResult>

type CliSpec = {
  args: (model: string, prompt: string) => string[]
}

// Non-interactive invocation per official CLI. The prompt is passed as an
// argument; the model flag maps the scoped model id to the CLI's own name.
const CLI_SPECS: Record<string, CliSpec> = {
  'codex-cli': { args: (model, prompt) => ['exec', '--model', model, prompt] },
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
): URHQ {
  const spec = CLI_SPECS[providerId]
  if (!spec) {
    throw new Error(`No subscription CLI dispatch is configured for provider "${providerId}".`)
  }
  const run = options.runner ?? defaultRunner

  async function doRequest(params: any, requestOptions?: any) {
    const model = cliModelName(params.model ?? options.model ?? '')
    if (!model) {
      throw new Error(`Provider "${providerId}" requires a model to dispatch to its CLI.`)
    }
    const prompt = messagesToPrompt(params)
    const result = await run(options.commandPath, spec.args(model, prompt), {
      signal: requestOptions?.signal,
      timeoutMs: options.timeoutMs ?? 120_000,
    })
    if (result.code !== 0) {
      throw new Error(
        `Subscription CLI "${options.commandPath}" for ${providerId} exited ${result.code}: ${
          result.stderr.trim() || result.stdout.trim() || 'no output'
        }`,
      )
    }
    const text = extractText(result.stdout)
    if (!text) {
      throw new Error(
        `Subscription CLI "${options.commandPath}" for ${providerId} produced no output.`,
      )
    }
    const data = {
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
    create(params: any, requestOptions?: any) {
      if (params.stream) {
        const pending = doRequest(params, requestOptions)
        return {
          async withResponse() {
            const { response, data } = await pending
            return {
              data: createOneShotMessageStream(data),
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
    async countTokens(params: any) {
      return { input_tokens: estimateTokens(messagesToPrompt(params)) }
    },
  }

  return { beta: { messages: messagesAPI } } as URHQ
}

const defaultRunner: SubscriptionCliRunner = (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], signal: options.signal })
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
    if (options.input) {
      child.stdin?.write(options.input)
    }
    child.stdin?.end()
  })

function cliModelName(model: string): string {
  const slash = model.indexOf('/')
  return slash >= 0 ? model.slice(slash + 1) : model
}

function messagesToPrompt(params: any): string {
  const parts: string[] = []
  const system = systemToText(params.system)
  if (system) parts.push(system)
  const messages = params.messages ?? []
  const label = messages.length > 1
  for (const message of messages) {
    const text = contentToText(message.content)
    if (!text) continue
    parts.push(label ? `${capitalize(message.role)}: ${text}` : text)
  }
  return parts.join('\n\n')
}

function extractText(stdout: string): string {
  const raw = stdout.trim()
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'string') return parsed
    const candidate =
      parsed.result ??
      parsed.response ??
      parsed.text ??
      parsed.output ??
      parsed.message?.content ??
      parsed.choices?.[0]?.message?.content ??
      (Array.isArray(parsed.content)
        ? parsed.content.map((block: any) => block?.text ?? '').join('')
        : undefined)
    if (typeof candidate === 'string' && candidate.trim()) return candidate
  } catch {
    // Not JSON: fall through to raw stdout.
  }
  return raw
}

function systemToText(system: any): string {
  if (!system) return ''
  if (typeof system === 'string') return system
  if (Array.isArray(system)) return system.map(block => block?.text ?? '').join('\n\n')
  return ''
}

function contentToText(content: any): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(block => {
      if (typeof block === 'string') return block
      if (block?.type === 'text') return block.text ?? ''
      if (block?.type === 'tool_result') return contentToText(block.content)
      return ''
    })
    .join('\n')
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value
}

function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4)
}
