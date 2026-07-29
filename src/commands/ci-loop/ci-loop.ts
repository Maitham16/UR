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

function missingOptionValue(tokens: string[], name: string): boolean {
  const index = tokens.indexOf(name)
  return (
    index !== -1 &&
    (tokens[index + 1] === undefined || tokens[index + 1]!.startsWith('--'))
  )
}

function invalidPositiveInteger(raw: string | undefined): boolean {
  if (raw === undefined) return false
  const value = Number(raw)
  return !Number.isSafeInteger(value) || value < 1
}

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  for (const name of [
    '--command',
    '--cwd',
    '--max-attempts',
    '--max-turns',
    '--from-log',
  ]) {
    if (missingOptionValue(tokens, name)) {
      return {
        type: 'text',
        value: `${name} requires a value.`,
        exitCode: 2,
      }
    }
  }
  const command = option(tokens, '--command') ?? 'bun test'
  const maxAttemptsRaw = option(tokens, '--max-attempts')
  const maxTurnsRaw = option(tokens, '--max-turns')
  const fromLog = option(tokens, '--from-log')
  if (!command.trim()) {
    return {
      type: 'text',
      value: '--command must be a non-empty command.',
      exitCode: 2,
    }
  }
  if (invalidPositiveInteger(maxAttemptsRaw)) {
    return {
      type: 'text',
      value: '--max-attempts must be a positive integer.',
      exitCode: 2,
    }
  }
  if (invalidPositiveInteger(maxTurnsRaw)) {
    return {
      type: 'text',
      value: '--max-turns must be a positive integer.',
      exitCode: 2,
    }
  }
  const allowGenerated = tokens.includes('--allow-generated')
  const allowDeletion = tokens.includes('--allow-delete') || tokens.includes('--allow-deletion')

  const activeCwd = getCwd()
  const configuredCwd = option(tokens, '--cwd')
  const cwd = configuredCwd ? resolve(activeCwd, configuredCwd) : activeCwd
  try {
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      return {
        type: 'text',
        value: `CI loop working directory does not exist or is not a directory: ${cwd}`,
        exitCode: 2,
      }
    }
  } catch (error) {
    return {
      type: 'text',
      value: `Cannot inspect CI loop working directory ${cwd}: ${error instanceof Error ? error.message : String(error)}`,
      exitCode: 2,
    }
  }

  let seedError: string | undefined
  if (fromLog) {
    const logPath = resolve(cwd, fromLog)
    try {
      if (!existsSync(logPath) || !statSync(logPath).isFile()) {
        return {
          type: 'text',
          value: `Log file not found or not a regular file: ${logPath}`,
          exitCode: 2,
        }
      }
      seedError = readFileSync(logPath, 'utf-8')
    } catch (error) {
      return {
        type: 'text',
        value: `Cannot read CI log ${logPath}: ${error instanceof Error ? error.message : String(error)}`,
        exitCode: 2,
      }
    }
  }

  try {
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

    return {
      type: 'text',
      value: formatCiLoopResult(result, json),
      ...(result.status === 'passed' ? {} : { exitCode: 1 }),
    }
  } catch (error) {
    return {
      type: 'text',
      value: `CI loop failed to run: ${error instanceof Error ? error.message : String(error)}`,
      exitCode: 1,
    }
  }
}
