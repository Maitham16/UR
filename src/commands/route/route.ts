import { formatRoute, routeIntent } from '../../services/agents/intentRouter.js'
import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const task = tokens.filter(token => token !== '--json').join(' ').trim()
  if (!task) {
    return {
      type: 'text',
      value: 'Usage: ur route "<task>" [--json]',
      exitCode: 2,
    }
  }
  const result = routeIntent(task)
  return { type: 'text', value: formatRoute(result, json) }
}
