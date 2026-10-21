import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'
import { getSandboxReadiness, runSafetyAudit, writeSandboxedPreset } from '../../services/safety/safetyReadiness.js'
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
    '  ur safety init [--preset sandboxed] [--allow-domain <hostname>]',
    '  ur safety check --command "<cmd>" [--json]',
    '  ur safety audit [--json]',
    '',
    'The default policy maps commands to approval levels: read-only,',
    'edit project, run safe commands, run network commands, and',
    'destructive commands. It asks before destructive operations,',
    'recommends sandboxing for risky operations, and blocks common secret',
    'exfiltration paths. Pattern checks are not an OS sandbox.',
    'The sandboxed preset is written separately and only takes effect when',
    'explicitly supplied with --settings; current permissions remain unchanged.',
  ].join('\n')
}

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  return index === -1 ? undefined : tokens[index + 1]
}

function positionals(tokens: string[]): string[] {
  const flagsWithValue = new Set(['--command', '--preset', '--allow-domain'])
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
    const preset = option(tokens, '--preset')
    if (tokens.includes('--preset') && !preset) throw new Error('--preset requires a name.')
    if (!preset && tokens.includes('--allow-domain')) throw new Error('--allow-domain requires --preset sandboxed.')
    if (preset) {
      if (preset !== 'sandboxed') throw new Error('Unknown safety preset. Available: sandboxed')
      const domains = tokens.flatMap((token, index) => token === '--allow-domain' ? [tokens[index + 1] ?? ''] : [])
      const result = writeSandboxedPreset(cwd, { domains })
      const next = 'ur --settings .ur/sandboxed.settings.json'
      const notes = [
        'Review the generated file, then opt in with the command below. Existing settings and permission mode are unchanged.',
        'Requires a working OS sandbox, forbids unsandboxed fallback and limits egress to configured/permission-allowed hosts.',
        'Credential deny rules capture current secret-like environment variable names only; regenerate for new names. No values are stored.',
        'External provider CLI internals, hooks and MCP servers are outside this shell boundary. Native tools retain their configured permission rules.',
      ]
      return { type: 'text', value: json ? JSON.stringify({ path: result.path, next, notes }, null, 2)
        : [`Wrote ${result.path}`, ...notes, next].join('\n') }
    }
    const path = writeProjectSafetyPolicy(cwd)
    return {
      type: 'text',
      value: json ? JSON.stringify({ path }, null, 2) : `Wrote ${path}`,
    }
  }

  if (action === 'audit') {
    const audit = runSafetyAudit(cwd)
    return { type: 'text', value: json ? JSON.stringify(audit, null, 2) : [
      `Offline safety regression: ${audit.ok ? 'PASS' : 'FAIL'}`,
      `Injection signals: ${audit.injection.detected}/${audit.injection.attacks} attacks flagged; ${audit.injection.falsePositives}/${audit.injection.benign} benign false positives`,
      `Project policy: ${audit.policy.filter(result => result.passed).length}/${audit.policy.length} expected decisions`,
      `Sandbox: ${audit.sandbox.status} (${audit.sandbox.attestation})`,
      ...audit.limits,
    ].join('\n') }
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
      sandbox: getSandboxReadiness(),
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
            `  OS sandbox: ${status.sandbox.status}; availability is configuration/dependency evidence only`,
            `  scope: ${status.sandbox.scope}`,
          ].join('\n'),
    }
  }

  return { type: 'text', value: usage() }
}
