import { existsSync, readFileSync } from 'node:fs'
import type { LocalCommandCall } from '../../types/command.js'
import { formatCiLoopResult, runCiLoop } from '../../services/agents/ciLoop.js'
import {
  isContainerized,
  resolveExecTarget,
} from '../../services/agents/execTarget.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  return index === -1 ? undefined : tokens[index + 1]
}

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const command = option(tokens, '--command') ?? 'bun test'
  const maxAttemptsRaw = option(tokens, '--max-attempts')
  const maxTurnsRaw = option(tokens, '--max-turns')
  const fromLog = option(tokens, '--from-log')

  let seedError: string | undefined
  if (fromLog) {
    if (!existsSync(fromLog)) {
      return { type: 'text', value: `Log file not found: ${fromLog}` }
    }
    seedError = readFileSync(fromLog, 'utf-8')
  }

  const cwd = getCwd()
  // Honor a configured reproducible container target (opt-in; default local).
  const target = resolveExecTarget(cwd)
  const result = await runCiLoop({
    cwd,
    command,
    maxAttempts: maxAttemptsRaw ? Number(maxAttemptsRaw) : undefined,
    commit: tokens.includes('--commit') || tokens.includes('--push'),
    push: tokens.includes('--push'),
    dryRun: tokens.includes('--dry-run'),
    skipPermissions: tokens.includes('--skip-permissions'),
    maxTurns: maxTurnsRaw ? Number(maxTurnsRaw) : undefined,
    seedError,
    execTarget: isContainerized(target) ? target : undefined,
  })

  return { type: 'text', value: formatCiLoopResult(result, json) }
}
