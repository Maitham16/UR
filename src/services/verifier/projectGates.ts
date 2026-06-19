// Project gates — run a list of project-defined commands after the agent
// performs a side effect, and feed the output back as evidence.
//
// Configuration lives in `<cwd>/.ur/verify.json` with the shape:
//
// {
//   "afterEdit":  ["bun x tsc --noEmit", "bun test --quiet"],
//   "afterBash":  [],
//   "ignorePatterns": ["**/*.md", "node_modules/**"],
//   "timeoutMs": 60000
// }
//
// Commands are run sequentially, fail-fast. A non-zero exit blocks the
// "done" claim and the agent receives the failing output as a tool-style
// reminder so it can address the failure on the next turn.

import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import picomatch from 'picomatch'

export type VerifyConfig = {
  afterEdit?: string[]
  afterBash?: string[]
  ignorePatterns?: string[]
  timeoutMs?: number
}

export type GateRunResult =
  | { ok: true; ranCommands: number }
  | {
      ok: false
      command: string
      exitCode: number | null
      stdout: string
      stderr: string
      reminder: string
    }

const DEFAULT_TIMEOUT_MS = 60_000
const MAX_OUTPUT_CHARS_PER_STREAM = 4_000

/**
 * Load `.ur/verify.json` from the given cwd. Returns null if absent or
 * malformed; verifier should treat null as "no gates configured".
 */
export async function loadVerifyConfig(
  cwd: string,
): Promise<VerifyConfig | null> {
  const path = join(cwd, '.ur', 'verify.json')
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const cfg = parsed as Record<string, unknown>
    const out: VerifyConfig = {}
    if (Array.isArray(cfg.afterEdit)) {
      out.afterEdit = cfg.afterEdit.filter(
        (c): c is string => typeof c === 'string',
      )
    }
    if (Array.isArray(cfg.afterBash)) {
      out.afterBash = cfg.afterBash.filter(
        (c): c is string => typeof c === 'string',
      )
    }
    if (Array.isArray(cfg.ignorePatterns)) {
      out.ignorePatterns = cfg.ignorePatterns.filter(
        (p): p is string => typeof p === 'string',
      )
    }
    if (typeof cfg.timeoutMs === 'number' && cfg.timeoutMs > 0) {
      out.timeoutMs = cfg.timeoutMs
    }
    return out
  } catch {
    return null
  }
}

/**
 * Decide which command list (if any) to run.
 *
 * - modifiedFiles non-empty → run `afterEdit`, after ignorePatterns filter.
 * - ranBash and modifiedFiles empty → run `afterBash`.
 * - otherwise → return null (nothing to run).
 */
export function pickCommands(
  config: VerifyConfig,
  modifiedFiles: string[],
  ranBash: boolean,
): string[] | null {
  const filteredEdits = filterIgnored(modifiedFiles, config.ignorePatterns)
  if (filteredEdits.length > 0 && config.afterEdit && config.afterEdit.length > 0) {
    return config.afterEdit
  }
  if (
    ranBash &&
    filteredEdits.length === 0 &&
    config.afterBash &&
    config.afterBash.length > 0
  ) {
    return config.afterBash
  }
  return null
}

function filterIgnored(
  files: string[],
  ignorePatterns: string[] | undefined,
): string[] {
  if (!ignorePatterns || ignorePatterns.length === 0) return files
  const matcher = picomatch(ignorePatterns)
  return files.filter(f => !matcher(f))
}

/**
 * Run a list of commands sequentially. Stops on the first non-zero exit
 * and returns a reminder suitable for injecting back into the conversation.
 */
export async function runGateCommands(
  commands: string[],
  cwd: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<GateRunResult> {
  let ran = 0
  for (const cmd of commands) {
    const result = await runSingleCommand(cmd, cwd, timeoutMs)
    ran += 1
    if (result.exitCode === 0) continue
    return {
      ok: false,
      command: cmd,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      reminder: buildFailureReminder(cmd, result),
    }
  }
  return { ok: true, ranCommands: ran }
}

type ChildResult = {
  exitCode: number | null
  stdout: string
  stderr: string
}

function runSingleCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<ChildResult> {
  return new Promise(resolve => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      stderr += `\n[verifier: command exceeded ${timeoutMs}ms timeout]`
    }, timeoutMs)
    child.stdout?.on('data', chunk => {
      stdout += chunk.toString()
      if (stdout.length > MAX_OUTPUT_CHARS_PER_STREAM) {
        stdout = stdout.slice(-MAX_OUTPUT_CHARS_PER_STREAM)
      }
    })
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString()
      if (stderr.length > MAX_OUTPUT_CHARS_PER_STREAM) {
        stderr = stderr.slice(-MAX_OUTPUT_CHARS_PER_STREAM)
      }
    })
    child.on('error', err => {
      clearTimeout(timer)
      resolve({
        exitCode: null,
        stdout,
        stderr: stderr + `\n[verifier: spawn error: ${err.message}]`,
      })
    })
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ exitCode: code, stdout, stderr })
    })
  })
}

function buildFailureReminder(command: string, result: ChildResult): string {
  const parts = [
    `Project verify gate FAILED.`,
    `Command: ${command}`,
    `Exit code: ${result.exitCode ?? 'killed'}`,
  ]
  const stdoutTrimmed = result.stdout.trim()
  if (stdoutTrimmed) {
    parts.push(`stdout (last ${MAX_OUTPUT_CHARS_PER_STREAM} chars):\n${stdoutTrimmed}`)
  }
  const stderrTrimmed = result.stderr.trim()
  if (stderrTrimmed) {
    parts.push(`stderr (last ${MAX_OUTPUT_CHARS_PER_STREAM} chars):\n${stderrTrimmed}`)
  }
  parts.push(
    `You may not declare the task complete until this command exits 0. ` +
      `Read the output, fix the underlying issue, and re-run the work this ` +
      `turn — do not just retry the verify command.`,
  )
  return parts.join('\n\n')
}
