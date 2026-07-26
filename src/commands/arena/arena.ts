import type { LocalCommandCall } from '../../types/command.js'
import { formatArenaResult, runArena } from '../../services/agents/arena.js'
import { splitCommand } from '../../services/agents/ciLoop.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  return index === -1 ? undefined : tokens[index + 1]
}

function freeText(tokens: string[]): string {
  const withValue = new Set([
    '--agents',
    '--max-turns',
    '--models',
    '--judge',
    '--judge-model',
    '--judge-rubric',
    '--verify',
  ])
  const parts: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (withValue.has(token)) {
      i++
      continue
    }
    if (token.startsWith('--')) continue
    parts.push(token)
  }
  return parts.join(' ').trim()
}

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const task = freeText(tokens)
  if (!task) {
    process.exitCode = 1
    return {
      type: 'text',
      value:
        'Usage: ur arena "<task>" [--agents N] [--judge deterministic|model|hybrid] [--judge-model M] [--verify "cmd"] [--apply] [--json]',
    }
  }

  const agentsRaw = option(tokens, '--agents')
  const maxTurnsRaw = option(tokens, '--max-turns')
  if (
    tokens.includes('--agents') &&
    (agentsRaw === undefined ||
      !/^\d+$/u.test(agentsRaw) ||
      !Number.isSafeInteger(Number(agentsRaw)) ||
      Number(agentsRaw) < 2 ||
      Number(agentsRaw) > 8)
  ) {
    process.exitCode = 1
    return {
      type: 'text',
      value: '--agents must be an integer between 2 and 8.',
    }
  }
  if (
    tokens.includes('--max-turns') &&
    (maxTurnsRaw === undefined ||
      !/^\d+$/u.test(maxTurnsRaw) ||
      !Number.isSafeInteger(Number(maxTurnsRaw)) ||
      Number(maxTurnsRaw) < 1)
  ) {
    process.exitCode = 1
    return {
      type: 'text',
      value: '--max-turns must be a positive integer.',
    }
  }
  const models = option(tokens, '--models')?.split(',').map(m => m.trim() || undefined)
  const judgeMode = option(tokens, '--judge') as
    | 'deterministic'
    | 'model'
    | 'hybrid'
    | undefined
  if (
    tokens.includes('--judge') &&
    (judgeMode === undefined ||
      !['deterministic', 'model', 'hybrid'].includes(judgeMode))
  ) {
    process.exitCode = 1
    return {
      type: 'text',
      value: '--judge must be deterministic, model, or hybrid.',
    }
  }
  const verify = tokens.flatMap((token, index) => {
    if (token !== '--verify' || !tokens[index + 1]) return []
    const parsed = splitCommand(tokens[index + 1]!)
    return [{ file: parsed.file, args: parsed.args }]
  })
  const events: string[] = []

  const result = await runArena(task, {
    cwd: getCwd(),
    agents: agentsRaw ? Number(agentsRaw) : undefined,
    models,
    dryRun: tokens.includes('--dry-run'),
    apply: tokens.includes('--apply'),
    keep: tokens.includes('--keep'),
    skipPermissions: tokens.includes('--skip-permissions'),
    maxTurns: maxTurnsRaw ? Number(maxTurnsRaw) : undefined,
    judgeMode,
    judgeModel: option(tokens, '--judge-model'),
    judgeRubric: option(tokens, '--judge-rubric'),
    verify,
    onEvent: event => {
      if (event.kind === 'done') {
        events.push(`  ${event.id}: ${event.isError ? 'error' : (event.verdict ?? 'no verdict')}`)
      }
    },
  })

  if (
    !tokens.includes('--dry-run') &&
    (!result.decision.valid ||
      result.winner === null ||
      (tokens.includes('--apply') && !result.applied))
  ) {
    process.exitCode = 1
  }
  const trace = !json && events.length ? `\n\nRuns:\n${events.join('\n')}` : ''
  return { type: 'text', value: `${formatArenaResult(result, json)}${trace}` }
}
