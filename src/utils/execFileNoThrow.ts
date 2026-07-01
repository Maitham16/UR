// This file represents useful wrappers over node:child_process
// These wrappers ease error handling and cross-platform compatbility
// By using execa, Windows automatically gets shell escaping + BAT / CMD handling

import { type ExecaError, execa } from 'execa'
import { getCwd } from '../utils/cwd.js'
import { logError } from './log.js'

export { execSyncWithDefaults_DEPRECATED } from './execFileNoThrowPortable.js'

const MS_IN_SECOND = 1000
const SECONDS_IN_MINUTE = 60

type ExecFileOptions = {
  abortSignal?: AbortSignal
  timeout?: number
  preserveOutputOnError?: boolean
  // Setting useCwd=false avoids circular dependencies during initialization
  // getCwd() -> PersistentShell -> logEvent() -> execFileNoThrow
  useCwd?: boolean
  env?: NodeJS.ProcessEnv
  stdin?: 'ignore' | 'inherit' | 'pipe'
  input?: string
  audit?: CommandAuditOptions | false
}

type CommandAuditOptions = {
  cwd?: string
  runId?: string
  reason?: string
  nextAction?: string
  toolUseId?: string
}

type ExecFileResult = { stdout: string; stderr: string; code: number; error?: string }

export function execFileNoThrow(
  file: string,
  args: string[],
  options: ExecFileOptions = {
    timeout: 10 * SECONDS_IN_MINUTE * MS_IN_SECOND,
    preserveOutputOnError: true,
    useCwd: true,
  },
): Promise<ExecFileResult> {
  return execFileNoThrowWithCwd(file, args, {
    abortSignal: options.abortSignal,
    timeout: options.timeout,
    preserveOutputOnError: options.preserveOutputOnError,
    cwd: options.useCwd ? getCwd() : undefined,
    env: options.env,
    stdin: options.stdin,
    input: options.input,
    audit: options.audit,
  })
}

type ExecFileWithCwdOptions = {
  abortSignal?: AbortSignal
  timeout?: number
  preserveOutputOnError?: boolean
  maxBuffer?: number
  cwd?: string
  env?: NodeJS.ProcessEnv
  shell?: boolean | string | undefined
  stdin?: 'ignore' | 'inherit' | 'pipe'
  input?: string
  audit?: CommandAuditOptions | false
}

type ExecaResultWithError = {
  shortMessage?: string
  signal?: string
}

/**
 * Extracts a human-readable error message from an execa result.
 *
 * Priority order:
 * 1. shortMessage - execa's human-readable error (e.g., "Command failed with exit code 1: ...")
 *    This is preferred because it already includes signal info when a process is killed,
 *    making it more informative than just the signal name.
 * 2. signal - the signal that killed the process (e.g., "SIGTERM")
 * 3. errorCode - fallback to just the numeric exit code
 */
function getErrorMessage(
  result: ExecaResultWithError,
  errorCode: number,
): string {
  if (result.shortMessage) {
    return result.shortMessage
  }
  if (typeof result.signal === 'string') {
    return result.signal
  }
  return String(errorCode)
}

/**
 * execFile, but always resolves (never throws)
 */
export function execFileNoThrowWithCwd(
  file: string,
  args: string[],
  {
    abortSignal,
    timeout: finalTimeout = 10 * SECONDS_IN_MINUTE * MS_IN_SECOND,
    preserveOutputOnError: finalPreserveOutput = true,
    cwd: finalCwd,
    env: finalEnv,
    maxBuffer,
    shell,
    stdin: finalStdin,
    input: finalInput,
    audit,
  }: ExecFileWithCwdOptions = {
    timeout: 10 * SECONDS_IN_MINUTE * MS_IN_SECOND,
    preserveOutputOnError: true,
    maxBuffer: 1_000_000,
  },
): Promise<ExecFileResult> {
  return new Promise(resolve => {
    const resolveWithAudit = (result: ExecFileResult): void => {
      void auditExecFileResult(file, args, result, {
        cwd: finalCwd,
        audit,
      }).finally(() => resolve(result))
    }

    // Use execa for cross-platform .bat/.cmd compatibility on Windows
    execa(file, args, {
      maxBuffer,
      signal: abortSignal,
      timeout: finalTimeout,
      cwd: finalCwd,
      env: finalEnv,
      shell,
      stdin: finalStdin,
      input: finalInput,
      reject: false, // Don't throw on non-zero exit codes
    })
      .then(result => {
        if (result.failed) {
          if (finalPreserveOutput) {
            const errorCode = result.exitCode ?? 1
            resolveWithAudit({
              stdout: result.stdout || '',
              stderr: result.stderr || '',
              code: errorCode,
              error: getErrorMessage(
                result as unknown as ExecaResultWithError,
                errorCode,
              ),
            })
          } else {
            resolveWithAudit({ stdout: '', stderr: '', code: result.exitCode ?? 1 })
          }
        } else {
          resolveWithAudit({
            stdout: result.stdout,
            stderr: result.stderr,
            code: 0,
          })
        }
      })
      .catch((error: ExecaError) => {
        logError(error)
        resolveWithAudit({ stdout: '', stderr: String(error.message ?? error), code: 1 })
      })
  })
}

function quoteCommandArg(arg: string): string {
  return /^[a-zA-Z0-9_./:=@+-]+$/.test(arg) ? arg : JSON.stringify(arg)
}

function formatCommand(file: string, args: string[]): string {
  return [file, ...args].map(quoteCommandArg).join(' ')
}

async function auditExecFileResult(
  file: string,
  args: string[],
  result: ExecFileResult,
  options: {
    cwd?: string
    audit?: CommandAuditOptions | false
  },
): Promise<void> {
  if (options.audit === false || process.env.UR_DISABLE_COMMAND_AUDIT === '1') {
    return
  }
  const cwd = options.audit?.cwd ?? options.cwd ?? getCwd()
  try {
    const [{ appendCommandLog, defaultNextAction }, { getSessionId }] = await Promise.all([
      import('../services/agents/commandLog.js'),
      import('../bootstrap/state.js'),
    ])
    appendCommandLog(cwd, options.audit?.runId ?? getSessionId(), {
      command: formatCommand(file, args),
      exitCode: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      reason: options.audit?.reason ?? 'execute local process command',
      nextAction: options.audit?.nextAction ?? defaultNextAction(result.code),
      toolUseId: options.audit?.toolUseId,
    })
  } catch (error) {
    logError(error)
  }
}
