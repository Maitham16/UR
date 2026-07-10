import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
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
  const allowGenerated = tokens.includes('--allow-generated')
  const allowDeletion = tokens.includes('--allow-delete') || tokens.includes('--allow-deletion')

  const activeCwd = getCwd()
  const configuredCwd = option(tokens, '--cwd')
  const cwd = configuredCwd ? resolve(activeCwd, configuredCwd) : activeCwd
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    return { type: 'text', value: `CI loop working directory does not exist or is not a directory: ${cwd}` }
  }

  let seedError: string | undefined
  if (fromLog) {
    const logPath = resolve(cwd, fromLog)
    if (!existsSync(logPath)) {
      return { type: 'text', value: `Log file not found: ${logPath}` }
    }
    seedError = readFileSync(logPath, 'utf-8')
  }

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
    allowGenerated,
    requireApprovalForDeletion: !allowDeletion,
  })

  return { type: 'text', value: formatCiLoopResult(result, json) }
}
