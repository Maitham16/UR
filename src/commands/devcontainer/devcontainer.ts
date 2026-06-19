import type { LocalCommandCall } from '../../types/command.js'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import {
  formatExecTarget,
  isContainerized,
  resolveExecTarget,
  scaffoldExecTarget,
  wrapCommand,
} from '../../services/agents/execTarget.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'

function optionValue(tokens: string[], flag: string): string | undefined {
  const index = tokens.indexOf(flag)
  return index >= 0 ? tokens[index + 1] : undefined
}

function usage(): string {
  return [
    'Usage:',
    '  ur devcontainer status [--json]',
    '  ur devcontainer init [--image <ref>] [--force]',
    '  ur devcontainer exec -- <command...> [--dry-run]',
    '',
    'Routes command execution through a reproducible container (opt-in).',
    'Configure via .ur/devcontainer.json or UR_EXEC_TARGET / UR_EXEC_IMAGE.',
    '`ci-loop` automatically honors the configured target.',
  ].join('\n')
}

export const call: LocalCommandCall = async (args: string) => {
  const cwd = getCwd()
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const action = tokens.find(token => !token.startsWith('--')) ?? 'status'

  if (action === 'help') return { type: 'text', value: usage() }

  if (action === 'init') {
    const result = scaffoldExecTarget(cwd, {
      force: tokens.includes('--force'),
      image: optionValue(tokens, '--image'),
    })
    return {
      type: 'text',
      value: result.created
        ? `Created ${result.path}. Edit "image" and run \`ur devcontainer status\`.`
        : `Kept existing ${result.path} (use --force to overwrite).`,
    }
  }

  if (action === 'status') {
    const config = resolveExecTarget(cwd)
    return {
      type: 'text',
      value: json ? JSON.stringify(config, null, 2) : formatExecTarget(config),
    }
  }

  if (action === 'exec' || action === 'run') {
    const config = resolveExecTarget(cwd)
    const sepIndex = tokens.indexOf('--')
    const rawParts =
      sepIndex >= 0
        ? tokens.slice(sepIndex + 1)
        : tokens.filter(t => t !== action && !t.startsWith('--'))
    if (rawParts.length === 0) return { type: 'text', value: usage() }
    const wrapped = wrapCommand(config, { file: rawParts[0]!, args: rawParts.slice(1) }, cwd)

    if (tokens.includes('--dry-run')) {
      return {
        type: 'text',
        value:
          `target: ${config.kind}\n` +
          `would run: ${wrapped.file} ${wrapped.args.join(' ')}`,
      }
    }
    if (!isContainerized(config)) {
      return {
        type: 'text',
        value:
          'Execution target is local; nothing to isolate. Run the command directly, ' +
          'or configure a container with `ur devcontainer init`.',
      }
    }
    const run = await execFileNoThrowWithCwd(wrapped.file, wrapped.args, {
      cwd,
      timeout: 30 * 60 * 1000,
      preserveOutputOnError: true,
    })
    const body = `${run.stdout}\n${run.stderr}`.trim()
    return {
      type: 'text',
      value: `exit ${run.code}${body ? `\n\n${body}` : ''}`,
    }
  }

  return { type: 'text', value: usage() }
}
