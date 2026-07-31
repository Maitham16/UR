import {
  extractOutputRedirections,
  splitCommand_DEPRECATED,
} from '../../utils/bash/commands.js'
import { tryParseShellCommand } from '../../utils/bash/shellQuote.js'
import { checkReadOnlyConstraints } from './readOnlyValidation.js'

type BashTaskListInput = {
  command: string
  run_in_background?: boolean
  dangerouslyDisableSandbox?: boolean
  _simulatedSedEdit?: unknown
}

const IDENTIFIER = '[A-Za-z_][A-Za-z0-9_]*'
const DOTTED_NAME = `${IDENTIFIER}(?:\\.${IDENTIFIER})*`
const IMPORT_ITEM = `${DOTTED_NAME}(?:[ \\t]+as[ \\t]+${IDENTIFIER})?`
const FROM_IMPORT_ITEM =
  `(?:${IDENTIFIER}|\\*)(?:[ \\t]+as[ \\t]+${IDENTIFIER})?`
const IMPORT_STATEMENT = new RegExp(
  `^import[ \\t]+${IMPORT_ITEM}(?:[ \\t]*,[ \\t]*${IMPORT_ITEM})*$`,
)
const FROM_IMPORT_STATEMENT = new RegExp(
  `^from[ \\t]+${DOTTED_NAME}[ \\t]+import[ \\t]+` +
    `(?:${FROM_IMPORT_ITEM}(?:[ \\t]*,[ \\t]*${FROM_IMPORT_ITEM})*|` +
    `\\([ \\t]*${FROM_IMPORT_ITEM}` +
    `(?:[ \\t]*,[ \\t]*${FROM_IMPORT_ITEM})*[ \\t]*\\))$`,
)

function isPurePythonImportScript(script: string): boolean {
  const statements = script
    .split(';')
    .map(statement => statement.trim())
    .filter(Boolean)
  return (
    statements.length > 0 &&
    statements.every(
      statement =>
        IMPORT_STATEMENT.test(statement) ||
        FROM_IMPORT_STATEMENT.test(statement),
    )
  )
}

function isCapabilityProbeCommand(command: string): boolean {
  const parsed = tryParseShellCommand(command)
  if (
    !parsed.success ||
    parsed.tokens.some(token => typeof token !== 'string')
  ) {
    return false
  }
  const argv = parsed.tokens as string[]
  if (argv.length === 2) {
    const [executable, flag] = argv
    if (
      executable &&
      /^[A-Za-z0-9_./+-]+$/.test(executable) &&
      ['--help', '--version', '-h', '-V', '-v'].includes(flag ?? '')
    ) {
      return true
    }
  }
  if (
    argv.length >= 3 &&
    argv[0] === 'command' &&
    (argv[1] === '-v' || argv[1] === '-V') &&
    argv.slice(2).every(name => /^[A-Za-z0-9_.+-]+$/.test(name))
  ) {
    return true
  }
  if (argv.length !== 3 || argv[1] !== '-c') return false
  const executable = argv[0]?.split('/').pop()
  return Boolean(
    executable &&
      /^python(?:\d+(?:\.\d+)*)?$/.test(executable) &&
      isPurePythonImportScript(argv[2] ?? ''),
  )
}

/**
 * Task tracking and permission auto-approval answer different questions.
 *
 * Bash permission checks are intentionally conservative: an interpreter
 * invocation is executable and therefore cannot be auto-approved merely
 * because its source looks observational. The task-list gate asks only
 * whether the command is implementation work that needs an actionable task.
 * This classifier keeps known read commands open and also recognizes generic
 * help/version probes plus import-only Python capability checks.
 *
 * Unknown interpreter source, output writes, extra statements, background
 * execution, sandbox overrides, and simulated edits remain task-gated.
 */
export function isBashTaskListReadOnly(input: BashTaskListInput): boolean {
  if (
    typeof input.command !== 'string' ||
    input.command.trim() === '' ||
    input.run_in_background === true ||
    input.dangerouslyDisableSandbox === true ||
    input._simulatedSedEdit !== undefined ||
    /[\0\r\n]/.test(input.command)
  ) {
    return false
  }

  const output = extractOutputRedirections(input.command)
  if (
    output.hasDangerousRedirection ||
    output.redirections.some(({ target }) => target !== '/dev/null')
  ) {
    return false
  }

  const subcommands = splitCommand_DEPRECATED(input.command)
  if (subcommands.length === 0) return false
  return subcommands.every(command => {
    const readOnly = checkReadOnlyConstraints(
      { command } as never,
      false,
    )
    return readOnly.behavior === 'allow' || isCapabilityProbeCommand(command)
  })
}
