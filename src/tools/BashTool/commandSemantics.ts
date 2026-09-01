/**
 * Command semantics configuration for interpreting exit codes in different contexts.
 *
 * Many commands use exit codes to convey information other than just success/failure.
 * For example, grep returns 1 when no matches are found, which is not an error condition.
 */

import { splitCommand_DEPRECATED } from '../../utils/bash/commands.js'
import { tryParseShellCommand } from '../../utils/bash/shellQuote.js'

export type CommandInterpretation = {
  isError: boolean
  message?: string
  displayStdout?: string
  displayStderr?: string
}

export type CommandSemantic = (
  exitCode: number,
  stdout: string,
  stderr: string,
) => CommandInterpretation

/**
 * Default semantic: treat only 0 as success, everything else as error
 */
const DEFAULT_SEMANTIC: CommandSemantic = (exitCode, _stdout, _stderr) => ({
  isError: exitCode !== 0,
  message:
    exitCode !== 0 ? `Command failed with exit code ${exitCode}` : undefined,
})

/**
 * Command-specific semantics
 */
const COMMAND_SEMANTICS: Map<string, CommandSemantic> = new Map([
  // grep: 0=matches found, 1=no matches, 2+=error
  [
    'grep',
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 2,
      message: exitCode === 1 ? 'No matches found' : undefined,
    }),
  ],

  // ripgrep has same semantics as grep
  [
    'rg',
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 2,
      message: exitCode === 1 ? 'No matches found' : undefined,
    }),
  ],

  // find: 0=success, 1=partial success (some dirs inaccessible), 2+=error
  [
    'find',
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 2,
      message:
        exitCode === 1 ? 'Some directories were inaccessible' : undefined,
    }),
  ],

  // diff: 0=no differences, 1=differences found, 2+=error
  [
    'diff',
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 2,
      message: exitCode === 1 ? 'Files differ' : undefined,
    }),
  ],

  // test/[: 0=condition true, 1=condition false, 2+=error
  [
    'test',
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 2,
      message: exitCode === 1 ? 'Condition is false' : undefined,
    }),
  ],

  // [ is an alias for test
  [
    '[',
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 2,
      message: exitCode === 1 ? 'Condition is false' : undefined,
    }),
  ],

  // wc, head, tail, cat, etc.: these typically only fail on real errors
  // so we use default semantics
])

/**
 * Get the semantic interpretation for a command
 */
function getCommandSemantic(command: string): CommandSemantic {
  // Extract the base command (first word, handling pipes)
  const baseCommand = heuristicallyExtractBaseCommand(command)
  const semantic = COMMAND_SEMANTICS.get(baseCommand)
  return semantic !== undefined ? semantic : DEFAULT_SEMANTIC
}

/**
 * Extract just the command name (first word) from a single command string.
 */
function extractBaseCommand(command: string): string {
  return command.trim().split(/\s+/)[0] || ''
}

/**
 * Extract the primary command from a complex command line;
 * May get it super wrong - don't depend on this for security
 */
function heuristicallyExtractBaseCommand(command: string): string {
  const segments = splitCommand_DEPRECATED(command)

  // Take the last command as that's what determines the exit code
  const lastCommand = segments[segments.length - 1] || command

  return extractBaseCommand(lastCommand)
}

function simpleSearchCommandName(command: string): 'grep' | 'rg' | null {
  const parsed = tryParseShellCommand(command, name => `$${name}`)
  if (!parsed.success || parsed.tokens.length === 0) return null

  // Restrict recovery to one direct command. Pipelines, redirects, command
  // substitutions, and compound expressions must retain their real status.
  if (
    parsed.tokens.some(
      token =>
        typeof token !== 'string' &&
        !(
          token &&
          typeof token === 'object' &&
          'op' in token &&
          token.op === 'glob'
        ),
    )
  ) {
    return null
  }

  const executable = parsed.tokens[0]
  if (typeof executable !== 'string') return null
  const basename = executable.replace(/\\/g, '/').split('/').pop()
  return basename === 'grep' || basename === 'rg' ? basename : null
}

function missingSearchTargets(
  command: string,
  exitCode: number,
  stdout: string,
  stderr: string,
): string[] | null {
  const searchCommand = simpleSearchCommandName(command)
  if (!searchCommand || exitCode < 2 || stdout.trim() !== '') return null

  const lines = stderr
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return null

  const targets: string[] = []
  for (const line of lines) {
    const grepMatch =
      searchCommand === 'grep'
        ? line.match(/^(?:.*[\\/])?grep: (.+): No such file or directory$/)
        : null
    const rgIoMatch =
      searchCommand === 'rg'
        ? line.match(
            /^(?:.*[\\/])?rg: (.+): IO error for operation on .+: No such file or directory(?: \(os error 2\))?$/,
          )
        : null
    const rgPlainMatch =
      searchCommand === 'rg'
        ? line.match(
            /^(?:.*[\\/])?rg: (.+): No such file or directory(?: \(os error 2\))?$/,
          )
        : null
    const target = grepMatch?.[1] ?? rgIoMatch?.[1] ?? rgPlainMatch?.[1]
    if (!target) return null
    targets.push(target)
  }

  return [...new Set(targets)]
}

/**
 * Interpret command result based on semantic rules
 */
export function interpretCommandResult(
  command: string,
  exitCode: number,
  stdout: string,
  stderr: string,
): CommandInterpretation {
  const absentTargets = missingSearchTargets(
    command,
    exitCode,
    stdout,
    stderr,
  )
  if (absentTargets) {
    const renderedTargets = absentTargets.map(target => `\`${target}\``).join(', ')
    return {
      isError: false,
      message:
        `No matching files found: ${renderedTargets}. ` +
        'The requested search target does not exist; discover available files with `rg --files` before retrying.',
      displayStdout: '',
      displayStderr: '',
    }
  }

  const semantic = getCommandSemantic(command)
  const result = semantic(exitCode, stdout, stderr)

  return {
    isError: result.isError,
    message: result.message,
  }
}
