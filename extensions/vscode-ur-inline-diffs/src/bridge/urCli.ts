// Safe wrapper for invoking the `ur` CLI from the extension. Always execFile
// with an explicit argv array — never a shell — so diff ids, file paths, and
// user-entered comment text can't be reinterpreted by a shell.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface UrCliResult {
  stdout: string
  stderr: string
}

export interface UrCliOptions {
  cwd: string
}

export async function runUrCli(args: string[], options: UrCliOptions): Promise<UrCliResult> {
  try {
    const { stdout, stderr } = await execFileAsync('ur', args, {
      cwd: options.cwd,
      shell: false,
    })
    return { stdout, stderr }
  } catch (error) {
    throw new Error(formatUrCliError(args, error))
  }
}

function formatUrCliError(args: string[], error: unknown): string {
  const stderr = hasStderr(error) ? error.stderr.trim() : ''
  const detail = stderr || (error instanceof Error ? error.message : String(error))
  return `Failed to run \`ur ${args.join(' ')}\`: ${detail}. Ensure the UR CLI is installed and on PATH.`
}

function hasStderr(error: unknown): error is { stderr: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'stderr' in error &&
    typeof (error as { stderr: unknown }).stderr === 'string'
  )
}
