// Streaming bridge to `ur -p --output-format stream-json --verbose
// --permission-prompt-tool stdio`. Spawns one child process per turn (never
// a shell), parses NDJSON line by line, and answers in-stream permission
// prompts by writing a control_response line to the child's stdin. Wire
// shapes are the CLI's own (src/cli/structuredIO.ts) — nothing here invents
// new vocabulary.

import { spawn as nodeSpawn } from 'node:child_process'
import type {
  ControlRequestEnvelope,
  PermissionDecision,
  StdoutMessage,
} from './types.js'
import { resolveUrCommand, type ResolvedUrCommand } from './urCommand.js'
import { isCanUseToolRequest, isControlRequest } from './types.js'

// Deliberately narrow interface — exactly what this module needs from a
// child process — rather than importing node:child_process's full
// (heavily overloaded) ChildProcess type. This is what makes `spawn`
// injectable with a plain fake object in tests, no real subprocess needed.
export interface UrChildProcess {
  stdout: NodeJS.ReadableStream | null
  stderr: NodeJS.ReadableStream | null
  stdin: NodeJS.WritableStream | null
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void
  on(event: 'error', listener: (error: Error) => void): void
  kill(signal?: NodeJS.Signals): boolean
}

export type SpawnFn = (
  command: string,
  args: string[],
  options: { cwd: string; shell: boolean; stdio: ['pipe', 'pipe', 'pipe'] },
) => UrChildProcess

// ---------------------------------------------------------------------------
// Pure NDJSON line buffering. No child process, no vscode — directly testable.
// ---------------------------------------------------------------------------

export class NdjsonBuffer {
  private buffer = ''

  /** Feed a raw chunk (may contain zero, one, or many complete lines, and may
   * split a line across two calls). Returns every complete, parseable line
   * found. Malformed lines are dropped, never thrown — the CLI's own
   * stdout-guard (streamJsonStdoutGuard.ts) already diverts non-JSON writes
   * to stderr, so a malformed line here means something unexpected slipped
   * through, not a reason to crash the extension. */
  push(chunk: string): StdoutMessage[] {
    this.buffer += chunk
    const messages: StdoutMessage[] = []
    for (;;) {
      const newline = this.buffer.indexOf('\n')
      if (newline === -1) break
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      const parsed = parseNdjsonLine(line)
      if (parsed) messages.push(parsed)
    }
    return messages
  }

  /** Whatever is left with no trailing newline yet (a genuinely partial line
   * stays buffered; call this only once the stream has actually ended). */
  flush(): StdoutMessage[] {
    const rest = this.buffer
    this.buffer = ''
    const parsed = parseNdjsonLine(rest)
    return parsed ? [parsed] : []
  }
}

function parseNdjsonLine(line: string): StdoutMessage | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const value: unknown = JSON.parse(trimmed)
    if (value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string') {
      return value as StdoutMessage
    }
    return null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Pure argv construction. `-p` (print/non-interactive) + stream-json always
// require --verbose together — the CLI errors otherwise (src/cli/print.ts).
// ---------------------------------------------------------------------------

export interface UrTurnRequest {
  cwd: string
  prompt: string
  /** CLI-issued session id from a prior turn's system/init message. Omitted
   * for the first turn of a brand new session — the CLI generates its own id
   * and reports it back rather than the extension guessing at an unseen one. */
  resumeSessionId?: string
  model?: string
}

export function buildUrArgs(request: Pick<UrTurnRequest, 'prompt' | 'resumeSessionId' | 'model'>): string[] {
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-prompt-tool',
    'stdio',
  ]
  if (request.resumeSessionId) args.push('--resume', request.resumeSessionId)
  if (request.model) args.push('--model', request.model)
  args.push(request.prompt)
  return args
}

// ---------------------------------------------------------------------------
// Pure control_response envelope construction. Matches the parser in
// src/cli/structuredIO.ts::processLine exactly: request_id and subtype live
// inside `response`, not at the envelope's top level.
// ---------------------------------------------------------------------------

export function buildControlResponse(requestId: string, decision: PermissionDecision): unknown {
  return {
    type: 'control_response',
    response: {
      request_id: requestId,
      subtype: 'success',
      response: decision,
    },
  }
}

// ---------------------------------------------------------------------------
// Orchestration. `spawn` is injectable so tests can drive a fake child
// process without a real `ur` binary.
// ---------------------------------------------------------------------------

export interface UrTurnResult {
  ok: boolean
  exitCode: number | null
  signal: NodeJS.Signals | null
  canceled: boolean
  /** True once a `result` NDJSON line was actually observed. If this is
   * false and `ok` is false, the failure came from stderr/exit code alone —
   * never treat that as reason to show fabricated assistant text. */
  sawResult: boolean
  stderr: string
  error?: string
}

export interface UrTurnHandlers {
  onMessage(message: StdoutMessage): void
  /** Must always be provided — there is no default/auto-approve path. The
   * caller owns the approval UI and default posture (ask, not allow). */
  onControlRequest(request: ControlRequestEnvelope): Promise<PermissionDecision>
  onExit(result: UrTurnResult): void
}

export interface UrTurnHandle {
  cancel(): void
}

export interface UrTurnDeps {
  spawn?: SpawnFn
  executable?: ResolvedUrCommand
  command?: string
}

const defaultSpawn: SpawnFn = (command, args, options) => nodeSpawn(command, args, options) as UrChildProcess

export function runUrTurn(request: UrTurnRequest, handlers: UrTurnHandlers, deps: UrTurnDeps = {}): UrTurnHandle {
  const spawnFn = deps.spawn ?? defaultSpawn
  const executable = deps.executable ?? (deps.command ? { command: deps.command, args: [], source: 'configured', display: deps.command } : resolveUrCommand({ cwd: request.cwd }))
  const args = [...executable.args, ...buildUrArgs(request)]

  let child: UrChildProcess
  try {
    child = spawnFn(executable.command, args, {
      cwd: request.cwd,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (error) {
    handlers.onExit({
      ok: false,
      exitCode: null,
      signal: null,
      canceled: false,
      sawResult: false,
      stderr: '',
      error: formatTurnFailure({
        executable,
        cwd: request.cwd,
        exitCode: null,
        signal: null,
        stderr: '',
        reason: `Failed to start: ${errorMessage(error)}`,
      }),
    })
    return { cancel: () => {} }
  }

  const stdoutBuffer = new NdjsonBuffer()
  const stderrChunks: string[] = []
  let sawResult = false
  let resultIsError = false
  let canceled = false
  let settled = false

  const finish = (exitCode: number | null, signal: NodeJS.Signals | null, spawnError?: string) => {
    if (settled) return
    settled = true
    const stderr = stderrChunks.join('')
    const ok = !canceled && !spawnError && sawResult && !resultIsError
    handlers.onExit({
      ok,
      exitCode,
      signal,
      canceled,
      sawResult,
      stderr,
      error: spawnError ?? (!ok && !canceled ? deriveErrorMessage(executable, request.cwd, sawResult, resultIsError, exitCode, signal, stderr) : undefined),
    })
  }

  const handleMessage = (message: StdoutMessage) => {
    if (message.type === 'result') {
      sawResult = true
      resultIsError = message.is_error === true
    }
    if (isControlRequest(message) && isCanUseToolRequest(message)) {
      void handlers
        .onControlRequest(message)
        .then(decision => {
          writeControlResponse(child, message.request_id, decision)
        })
        .catch(error => {
          // Treat a handler failure as a deny so the child never hangs
          // waiting on a prompt the extension silently dropped.
          writeControlResponse(child, message.request_id, {
            behavior: 'deny',
            message: `Permission prompt failed in the extension: ${errorMessage(error)}`,
          })
        })
    }
    handlers.onMessage(message)
  }

  child.stdout?.on('data', (chunk: Buffer) => {
    for (const message of stdoutBuffer.push(chunk.toString('utf8'))) {
      handleMessage(message)
    }
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk.toString('utf8'))
  })
  child.on('error', error => {
    finish(
      null,
      null,
      formatTurnFailure({
        executable,
        cwd: request.cwd,
        exitCode: null,
        signal: null,
        stderr: stderrChunks.join(''),
        reason: `Failed to run: ${errorMessage(error)}`,
      }),
    )
  })
  child.on('exit', (code, signal) => {
    for (const message of stdoutBuffer.flush()) {
      handleMessage(message)
    }
    finish(code, signal)
  })

  return {
    cancel: () => {
      if (settled) return
      canceled = true
      child.kill('SIGTERM')
    },
  }
}

function writeControlResponse(child: UrChildProcess, requestId: string, decision: PermissionDecision): void {
  try {
    child.stdin?.write(`${JSON.stringify(buildControlResponse(requestId, decision))}\n`)
  } catch {
    // Child already exited/closed stdin — nothing more to do; onExit will
    // still fire from the 'exit'/'error' listeners.
  }
}

function deriveErrorMessage(
  executable: ResolvedUrCommand,
  cwd: string,
  sawResult: boolean,
  resultIsError: boolean,
  exitCode: number | null,
  signal: NodeJS.Signals | null,
  stderr: string,
): string {
  const reason = sawResult && resultIsError
    ? 'UR reported an error completing this turn.'
    : 'UR exited without producing a successful result.'
  return formatTurnFailure({ executable, cwd, exitCode, signal, stderr, reason })
}

function formatTurnFailure(options: {
  executable: ResolvedUrCommand
  cwd: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  stderr: string
  reason: string
}): string {
  const stderr = summarizeStderr(options.stderr)
  return [
    `UR chat backend failed.`,
    `Executable: ${options.executable.display}`,
    `cwd: ${options.cwd}`,
    `Exit: code ${options.exitCode ?? 'unknown'}, signal ${options.signal ?? 'none'}`,
    `stderr: ${stderr || '<empty>'}`,
    options.reason,
    `Hint: Set ur.executablePath in VS Code settings if the extension is using the wrong UR binary.`,
  ].join('\n')
}

function summarizeStderr(stderr: string): string {
  const trimmed = stderr.trim()
  if (trimmed.length <= 2000) return trimmed
  return `${trimmed.slice(0, 2000)}…`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
