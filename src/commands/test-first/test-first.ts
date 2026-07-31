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
    }
  }

  const result = await runTestFirstLoop({
    cwd,
    maxAttempts: maxAttemptsRaw ? Number(maxAttemptsRaw) : undefined,
    dryRun: tokens.includes('--dry-run'),
    skipPermissions: tokens.includes('--skip-permissions'),
    maxTurns: maxTurnsRaw ? Number(maxTurnsRaw) : undefined,
    installGates: tokens.includes('--install-gates'),
  })
  return { type: 'text', value: formatTestFirstResult(result, json) }
}
