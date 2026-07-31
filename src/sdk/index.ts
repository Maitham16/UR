/**
 * UR programmatic SDK.
 *
 * A tiny, dependency-free wrapper around UR's headless mode (`ur -p
 * --output-format json`) so other programs can drive the agent without parsing
 * the TUI. It shells out to the installed `ur` binary, so it inherits the same
 * permission model, MCP config, and local Ollama routing as the interactive CLI.
 *
 * This is the embeddable counterpart to the loopback A2A server: A2A is for
 * agent-to-agent task hand-off over HTTP; this SDK is for in-process scripting.
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
      if (found) return found
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

/** Extract the final text from `ur -p --output-format json` output. */
export function parseResultText(stdout: string): string {
  const trimmed = stdout.trim()
  if (!trimmed) return ''
  try {
    return pickResultText(JSON.parse(trimmed)) ?? trimmed
  } catch {
    return trimmed
  }
}

function buildArgs(prompt: string, options: QueryOptions): string[] {
  const args = [...(options.bin?.args ?? []), '-p', '--output-format', options.outputFormat ?? 'json']
  if (options.maxTurns && options.maxTurns > 0) args.push('--max-turns', String(options.maxTurns))
  if (options.skipPermissions) args.push('--dangerously-skip-permissions')
  args.push(prompt)
  return args
}

/** Run a single headless UR query and resolve with its result. */
export function query(prompt: string, options: QueryOptions = {}): Promise<QueryResult> {
  const file = options.bin?.file ?? 'ur'
  const args = buildArgs(prompt, options)
  const env = {
    ...process.env,
    ...(options.model ? { UR_MODEL: options.model } : {}),
    ...(options.env ?? {}),
  }
  return new Promise(resolve => {
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
  const { text } = await query(prompt, options)
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
    return query(prompt, { ...this.defaults, ...options })
  }

  queryJSON<T = unknown>(prompt: string, options: QueryOptions = {}): Promise<T | null> {
    return queryJSON<T>(prompt, { ...this.defaults, ...options })
  }
}
