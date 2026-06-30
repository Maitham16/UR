import { listModelCapabilities } from '../model-doctor/model-doctor.js'
import {
  formatModelRoute,
  recommendModel,
  resolveModelForTask,
  type RouteStrategy,
} from '../../services/agents/modelRouter.js'
import { loadModelPool } from '../../services/agents/modelPool.js'
import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'

function optionValue(tokens: string[], flag: string): string | undefined {
  const index = tokens.indexOf(flag)
  return index >= 0 ? tokens[index + 1] : undefined
}

function taskText(tokens: string[]): string {
  const values: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === '--strategy') {
      i++
      continue
    }
    if (token.startsWith('--')) continue
    values.push(token)
  }
  return values.join(' ').trim()
}

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const strategy = (optionValue(tokens, '--strategy') ?? 'auto') as RouteStrategy
  const task = taskText(tokens)
  if (!task) {
    return {
      type: 'text',
      value: 'Usage: ur model-route "<task>" [--strategy auto|cheap|strong|default] [--json]',
    }
  }
  const { models } = await listModelCapabilities()
  const pool = loadModelPool(getCwd())
  const result = recommendModel(task, models)
  const resolved = resolveModelForTask(task, strategy, pool, models)
  if (json) {
    return {
      type: 'text',
      value: JSON.stringify({ ...result, strategy, resolved: resolved ?? null, pool }, null, 2),
    }
  }
  return {
    type: 'text',
    value: [
      formatModelRoute(result, false),
      '',
      `Routing strategy: ${strategy}`,
      `Resolved launch model: ${resolved ?? 'none'}`,
    ].join('\n'),
  }
}
