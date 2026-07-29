/**
 * UR programmatic SDK.
 *
 * A tiny, dependency-free wrapper around UR's headless mode (`ur -p
 * --output-format json`) so other programs can drive the agent without parsing
 * the TUI. It shells out to the installed `ur` binary, so it inherits the same
 * permission model, MCP config, and local Ollama routing as the interactive CLI.
 *
 * This is the subprocess counterpart to the loopback A2A server: A2A is for
 * agent-to-agent task hand-off over HTTP; this SDK is for local programmatic
 * calls that launch an installed `ur` process.
 *
 * @example
 *   import { query } from 'ur-agent/sdk'
 *   const { text } = await query('Summarize the README in one line')
 *   console.log(text)
 */

import { execFile } from 'node:child_process'

export type OutputFormat = 'json' | 'text' | 'stream-json'

export type QueryOptions = {
  /** Working directory for the run. Defaults to process.cwd(). */
  cwd?: string
  /** Force a specific Ollama model (sets UR_MODEL for the child). */
  model?: string
  /** Cap agentic turns. */
  maxTurns?: number
  /** Output format passed to `ur -p`. Defaults to 'json'. */
  outputFormat?: OutputFormat
  /** Pass --dangerously-skip-permissions (sandboxes/CI only). */
  skipPermissions?: boolean
  /** Kill the run after this many ms. Defaults to 30 minutes. */
  timeoutMs?: number
  /** Override the binary. Defaults to 'ur' on PATH. */
  bin?: { file: string; args?: string[] }
  /** Extra environment variables for the child process. */
  env?: Record<string, string>
}

export type QueryResult = {
  ok: boolean
  /** Best-effort final assistant text. */
  text: string
  /** Raw stdout from the child. */
  raw: string
  exitCode: number
  stderr: string
}

function pickResultText(parsed: unknown): string | null {
  if (parsed == null) return null
  if (typeof parsed === 'string') return parsed
  if (Array.isArray(parsed)) {
    for (let i = parsed.length - 1; i >= 0; i--) {
      const found = pickResultText(parsed[i])
      if (found !== null) return found
    }
    return null
  }
  if (typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    if (typeof obj.result === 'string') return obj.result
    if (typeof obj.text === 'string') return obj.text
    if (typeof obj.content === 'string') return obj.content
  }
  return null
}

function pickTerminalResultText(parsed: unknown[]): string | null {
  for (let i = parsed.length - 1; i >= 0; i--) {
    const item = parsed[i]
    if (
      typeof item === 'object' &&
      item !== null &&
      !Array.isArray(item) &&
      (item as Record<string, unknown>).type === 'result'
    ) {
      const found = pickResultText(item)
      if (found !== null) return found
    }
  }
  return null
}

/**
 * Extract the final text from JSON, text, or stream-json (NDJSON) output.
 *
 * For stream-json, the terminal `result` envelope wins even when lifecycle
 * events follow it. If the input is not structured output, the original
 * trimmed text is returned.
 */
export function parseResultText(stdout: string): string {
  const trimmed = stdout.trim()
  if (!trimmed) return ''
  try {
    return pickResultText(JSON.parse(trimmed)) ?? trimmed
  } catch {
    const parsedLines: unknown[] = []
    for (const line of trimmed.split(/\r?\n/u)) {
      const candidate = line.trim()
      if (!candidate) continue
      try {
        parsedLines.push(JSON.parse(candidate))
      } catch {
        // A plain-text or diagnostic line does not invalidate later NDJSON.
      }
    }
    if (parsedLines.length === 0) return trimmed
    // Mixed prose with incidental JSON is not the stream protocol. Only an
    // explicit terminal result envelope is authoritative; otherwise preserve
    // every byte of user-visible text (apart from the documented trim).
    return pickTerminalResultText(parsedLines) ?? trimmed
  }
}

function validateQueryInput(prompt: string, options: QueryOptions): void {
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new TypeError('prompt must be a non-empty string')
  }
  if (
    options.maxTurns !== undefined &&
    (!Number.isSafeInteger(options.maxTurns) || options.maxTurns <= 0)
  ) {
    throw new RangeError('maxTurns must be a positive safe integer')
  }
  if (
    options.timeoutMs !== undefined &&
    (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0)
  ) {
    throw new RangeError('timeoutMs must be a positive safe integer')
  }
  if (
    options.outputFormat !== undefined &&
    !(['json', 'text', 'stream-json'] as const).includes(options.outputFormat)
  ) {
    throw new TypeError(
      'outputFormat must be "json", "text", or "stream-json"',
    )
  }
}

function buildArgs(prompt: string, options: QueryOptions): string[] {
  const outputFormat = options.outputFormat ?? 'json'
  const args = [
    ...(options.bin?.args ?? []),
    '-p',
    '--output-format',
    outputFormat,
  ]
  // The CLI deliberately requires verbose mode for its complete NDJSON
  // protocol, so make the public stream-json option usable by construction.
  if (outputFormat === 'stream-json') args.push('--verbose')
  if (options.maxTurns !== undefined) {
    args.push('--max-turns', String(options.maxTurns))
  }
  if (options.skipPermissions) args.push('--dangerously-skip-permissions')
  args.push(prompt)
  return args
}

/** Run a single headless UR query and resolve with its result. */
export async function query(
  prompt: string,
  options: QueryOptions = {},
): Promise<QueryResult> {
  validateQueryInput(prompt, options)
  const file = options.bin?.file ?? 'ur'
  const args = buildArgs(prompt, options)
  const env = {
    ...process.env,
    ...(options.env ?? {}),
    // The typed model option is the authoritative selection even if callers
    // also provide UR_MODEL in the generic environment bag.
    ...(options.model ? { UR_MODEL: options.model } : {}),
  }
  return await new Promise(resolve => {
    execFile(
      file,
      args,
      { cwd: options.cwd, env, timeout: options.timeoutMs ?? 30 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const raw = stdout ?? ''
        const exitCode = error && typeof (error as { code?: unknown }).code === 'number'
          ? (error as { code: number }).code
          : error
            ? 1
            : 0
        resolve({
          ok: exitCode === 0,
          text: parseResultText(raw),
          raw,
          exitCode,
          stderr: stderr ?? '',
        })
      },
    )
  })
}

/** Run a query expecting JSON content and parse it (returns null on failure). */
export async function queryJSON<T = unknown>(prompt: string, options: QueryOptions = {}): Promise<T | null> {
  const { ok, text } = await query(prompt, options)
  if (!ok) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

/** A reusable client that applies shared defaults to every query. */
export class UrClient {
  constructor(private readonly defaults: QueryOptions = {}) {}

  query(prompt: string, options: QueryOptions = {}): Promise<QueryResult> {
    return query(prompt, this.mergeOptions(options))
  }

  queryJSON<T = unknown>(prompt: string, options: QueryOptions = {}): Promise<T | null> {
    return queryJSON<T>(prompt, this.mergeOptions(options))
  }

  private mergeOptions(options: QueryOptions): QueryOptions {
    return {
      ...this.defaults,
      ...options,
      env:
        this.defaults.env || options.env
          ? { ...(this.defaults.env ?? {}), ...(options.env ?? {}) }
          : undefined,
    }
  }
}
