import { listModelCapabilities } from '../model-doctor/model-doctor.js'
import { formatModelRoute, recommendModel } from '../../services/agents/modelRouter.js'
import type { LocalCommandCall } from '../../types/command.js'

export const call: LocalCommandCall = async (args: string) => {
  const json = /(^|\s)--json(\s|$)/.test(args)
  const task = args.replace(/(^|\s)--json(\s|$)/, ' ').trim()
  if (!task) {
    return {
      type: 'text',
      value: 'Usage: ur model-route "<task>" [--json]',
    }
  }
  const { models } = await listModelCapabilities()
  const result = recommendModel(task, models)
  return { type: 'text', value: formatModelRoute(result, json) }
}
