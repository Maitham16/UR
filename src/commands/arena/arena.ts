import type { LocalCommandCall } from '../../types/command.js'
import { formatArenaResult, runArena } from '../../services/agents/arena.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  return index === -1 ? undefined : tokens[index + 1]
}

function freeText(tokens: string[]): string {
  const withValue = new Set(['--agents', '--max-turns', '--models'])
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
    return {
      type: 'text',
      value:
        'Usage: ur arena "<task>" [--agents N] [--apply] [--keep] [--dry-run] [--max-turns N] [--skip-permissions] [--json]',
    }
  }

  const agentsRaw = option(tokens, '--agents')
  const maxTurnsRaw = option(tokens, '--max-turns')
  const models = option(tokens, '--models')?.split(',').map(m => m.trim() || undefined)
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
    onEvent: event => {
      if (event.kind === 'done') {
        events.push(`  ${event.id}: ${event.isError ? 'error' : (event.verdict ?? 'no verdict')}`)
      }
    },
  })

  const trace = !json && events.length ? `\n\nRuns:\n${events.join('\n')}` : ''
  return { type: 'text', value: `${formatArenaResult(result, json)}${trace}` }
}
