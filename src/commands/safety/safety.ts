import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'
import {
  DEFAULT_PROJECT_SAFETY_POLICY,
  evaluateShellSafetyPolicy,
  formatShellSafetyEvaluation,
  loadProjectSafetyPolicy,
  safetyPolicyPath,
  writeProjectSafetyPolicy,
} from '../../services/safety/projectSafety.js'

function usage(): string {
  return [
    'Usage:',
    '  ur safety status [--json]',
    '  ur safety init',
    '  ur safety check --command "<cmd>" [--json]',
    '',
    'The default policy maps commands to approval levels: read-only,',
    'edit project, run safe commands, run network commands, and',
    'destructive commands. It asks before destructive operations,',
    'recommends sandboxing for risky operations, and blocks common secret',
    'exfiltration paths.',
  ].join('\n')
}

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  return index === -1 ? undefined : tokens[index + 1]
}

function positionals(tokens: string[]): string[] {
  const flagsWithValue = new Set(['--command'])
  const values: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (flagsWithValue.has(token)) {
      i++
      continue
    }
    if (token.startsWith('--')) continue
    values.push(token)
  }
  return values
}

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const action = positionals(tokens)[0] ?? 'status'
  const cwd = getCwd()

  if (action === 'init') {
    const path = writeProjectSafetyPolicy(cwd)
    return {
      type: 'text',
      value: json ? JSON.stringify({ path }, null, 2) : `Wrote ${path}`,
    }
  }

  if (action === 'check') {
    const command = option(tokens, '--command') ?? positionals(tokens).slice(1).join(' ')
    if (!command) return { type: 'text', value: usage() }
    return {
      type: 'text',
      value: formatShellSafetyEvaluation(
        evaluateShellSafetyPolicy(command, cwd),
        json,
      ),
    }
  }

  if (action === 'status') {
    const policy = loadProjectSafetyPolicy(cwd)
    const status = {
      path: safetyPolicyPath(cwd),
      configured: policy !== DEFAULT_PROJECT_SAFETY_POLICY,
      permissionClasses: policy.permissionClasses,
      askBeforeRules: policy.askBefore.length,
      denyRules: policy.deny.length,
      sandboxRequiredFor: policy.sandboxRequiredFor,
    }
    return {
      type: 'text',
      value: json
        ? JSON.stringify(status, null, 2)
        : [
            'Project safety policy:',
            `  configured: ${status.configured ? 'yes' : 'default'}`,
            `  path: ${status.path}`,
            `  permission classes: ${Object.keys(status.permissionClasses).join(', ')}`,
            `  ask-before rules: ${status.askBeforeRules}`,
            `  deny rules: ${status.denyRules}`,
            `  sandbox for: ${status.sandboxRequiredFor.join(', ')}`,
          ].join('\n'),
    }
  }

  return { type: 'text', value: usage() }
}
