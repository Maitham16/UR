import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'
import {
  detectTestFirstStack,
  formatTestFirstResult,
  installTestFirstGates,
  runTestFirstLoop,
} from '../../services/agents/testFirstLoop.js'

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  return index === -1 ? undefined : tokens[index + 1]
}

function actionToken(tokens: string[]): string {
  const valueOptions = new Set(['--max-attempts', '--max-turns'])
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (valueOptions.has(token)) {
      i += 1
      continue
    }
    if (token.startsWith('--')) continue
    return token
  }
  return 'run'
}

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const action = actionToken(tokens)
  const cwd = getCwd()
  const maxAttemptsRaw = option(tokens, '--max-attempts')
  const maxTurnsRaw = option(tokens, '--max-turns')
  const maxAttempts =
    maxAttemptsRaw === undefined ? undefined : Number(maxAttemptsRaw)
  const maxTurns = maxTurnsRaw === undefined ? undefined : Number(maxTurnsRaw)
  if (
    maxAttempts !== undefined &&
    (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1)
  ) {
    return {
      type: 'text',
      value: '--max-attempts must be a positive integer.',
      exitCode: 2,
    }
  }
  if (
    maxTurns !== undefined &&
    (!Number.isSafeInteger(maxTurns) || maxTurns < 1)
  ) {
    return {
      type: 'text',
      value: '--max-turns must be a positive integer.',
      exitCode: 2,
    }
  }

  if (action === 'detect') {
    const stack = detectTestFirstStack(cwd)
    return {
      type: 'text',
      value: json
        ? JSON.stringify(stack, null, 2)
        : [
            'Detected test-first stack:',
            `Languages: ${stack.languages.join(', ') || 'unknown'}`,
            `Package managers: ${stack.packageManagers.join(', ') || 'unknown'}`,
            'Commands:',
            ...stack.commands.map(command => `  ${command.phase}: ${command.command}`),
            `Missing phases: ${stack.missingPhases.join(', ') || 'none'}`,
          ].join('\n'),
    }
  }

  if (action === 'install') {
    const stack = detectTestFirstStack(cwd)
    const installed = installTestFirstGates(cwd, stack)
    return {
      type: 'text',
      value: json
        ? JSON.stringify(installed, null, 2)
        : [
            `Installed test-first gates: ${installed.path}`,
            ...installed.commands.map(command => `  ${command}`),
          ].join('\n'),
      ...(stack.commands.length > 0 ? {} : { exitCode: 1 }),
    }
  }

  if (action !== 'run') {
    return {
      type: 'text',
      value: 'Usage: ur test-first detect|run|install [options]',
      exitCode: 2,
    }
  }

  const result = await runTestFirstLoop({
    cwd,
    maxAttempts,
    dryRun: tokens.includes('--dry-run'),
    skipPermissions: tokens.includes('--skip-permissions'),
    maxTurns,
    installGates: tokens.includes('--install-gates'),
  })
  return {
    type: 'text',
    value: formatTestFirstResult(result, json),
    ...(
      result.status === 'passed' || result.status === 'planned'
        ? {}
        : { exitCode: 1 }
    ),
  }
}
