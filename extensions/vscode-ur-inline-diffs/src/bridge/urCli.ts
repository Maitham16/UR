// Safe wrapper for invoking the `ur` CLI from the extension. Always execFile
// with an explicit argv array — never a shell — so diff ids, file paths, and
// user-entered comment text can't be reinterpreted by a shell.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type * as VscodeNamespace from 'vscode'
import { resolveUrCommand, type ResolvedUrCommand, type UrCommandConfig } from './urCommand.js'

const execFileAsync = promisify(execFile)

export interface UrCliResult {
  stdout: string
  stderr: string
}

export interface UrCliOptions {
  cwd: string
  timeoutMs?: number
  maxBufferBytes?: number
}

function boundedExecutionOptions(options: UrCliOptions): {
  cwd: string
  shell: false
  timeout: number
  maxBuffer: number
  windowsHide: true
} {
  const timeout = Number.isSafeInteger(options.timeoutMs) && (options.timeoutMs ?? 0) > 0
    ? Math.min(options.timeoutMs!, 10 * 60_000)
    : 120_000
  const maxBuffer = Number.isSafeInteger(options.maxBufferBytes) && (options.maxBufferBytes ?? 0) > 0
    ? Math.min(options.maxBufferBytes!, 16 * 1024 * 1024)
    : 4 * 1024 * 1024
  return {
    cwd: options.cwd,
    shell: false,
    timeout,
    maxBuffer,
    windowsHide: true,
  }
}

export async function runUrCli(args: string[], options: UrCliOptions): Promise<UrCliResult> {
  const executable = resolveUrCommand({ cwd: options.cwd, config: readUrCommandConfig() })
  try {
    const { stdout, stderr } = await execFileAsync(
      executable.command,
      [...executable.args, ...args],
      boundedExecutionOptions(options),
    )
    return { stdout, stderr }
  } catch (error) {
    throw new Error(formatUrCliError(args, error, executable, options.cwd))
  }
}

export interface UrCliCaptureResult extends UrCliResult {
  exitCode: number
}

/**
 * Like runUrCli, but never throws on a non-zero exit. Some `ur` subcommands
 * (`provider status`, `provider doctor`) intentionally exit 1 to signal
 * "not ready" while still writing a complete, valid JSON payload to stdout.
 * Callers that need that payload regardless of readiness (status/options
 * surfaces) use this instead of runUrCli, which would discard the JSON and
 * throw. Genuine spawn failures (`ur` missing from PATH, etc.) still throw.
 */
export async function runUrCliCapture(args: string[], options: UrCliOptions): Promise<UrCliCaptureResult> {
  const executable = resolveUrCommand({ cwd: options.cwd, config: readUrCommandConfig() })
  try {
    const { stdout, stderr } = await execFileAsync(
      executable.command,
      [...executable.args, ...args],
      boundedExecutionOptions(options),
    )
    return { stdout, stderr, exitCode: 0 }
  } catch (error) {
    if (isCapturedNonZeroExit(error)) {
      return { stdout: error.stdout, stderr: error.stderr, exitCode: error.code }
    }
    throw new Error(formatUrCliError(args, error, executable, options.cwd))
  }
}

export function readUrCommandConfig(): UrCommandConfig {
  try {
    const vscode = require('vscode') as typeof VscodeNamespace
    const config = vscode.workspace.getConfiguration('ur')
    const executablePath = config.get<string>('executablePath')?.trim()
    const executableArgs = config.get<string[]>('executableArgs') ?? []
    return {
      executablePath: executablePath || undefined,
      executableArgs: executableArgs.filter(arg => typeof arg === 'string' && arg.length > 0),
    }
  } catch {
    return {}
  }
}

function formatUrCliError(args: string[], error: unknown, executable: ResolvedUrCommand, cwd: string): string {
  const stderr = hasStderr(error) ? error.stderr.trim() : ''
  const detail = stderr || (error instanceof Error ? error.message : String(error))
  return [
    `Failed to run UR command.`,
    `Executable: ${executable.display}`,
    `cwd: ${cwd}`,
    `Args: ${args.join(' ')}`,
    `Error: ${detail}`,
    `Hint: Set ur.executablePath in VS Code settings if the extension is using the wrong UR binary.`,
  ].join('\n')
}

function hasStderr(error: unknown): error is { stderr: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'stderr' in error &&
    typeof (error as { stderr: unknown }).stderr === 'string'
  )
}

// A promisified execFile that exits non-zero still carries `.stdout`/`.stderr`
// (Node attaches them to the rejected error for exactly this reason) and a
// numeric `.code` equal to the process exit code. That numeric code is the
// discriminator against spawn-level failures like ENOENT, where `.code` is a
// string ('ENOENT') and `.stdout` was never populated because nothing ran.
function isCapturedNonZeroExit(error: unknown): error is { stdout: string; stderr: string; code: number } {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'number' &&
    typeof (error as { stdout?: unknown }).stdout === 'string'
  )
}
