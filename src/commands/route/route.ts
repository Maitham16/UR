import { formatRoute, routeIntent } from '../../services/agents/intentRouter.js'
import type { LocalCommandCall } from '../../types/command.js'

export const call: LocalCommandCall = async (args: string) => {
  const json = /(^|\s)--json(\s|$)/.test(args)
  const task = args.replace(/(^|\s)--json(\s|$)/, ' ').trim()
  if (!task) {
    return {
      type: 'text',
      value: 'Usage: ur route "<task>" [--json]',
    }
  }
  const result = routeIntent(task)
  return { type: 'text', value: formatRoute(result, json) }
}
