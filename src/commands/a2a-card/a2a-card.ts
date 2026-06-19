import { formatA2AAgentCard } from '../../services/agents/trends.js'
import type { LocalCommandCall } from '../../types/command.js'

export const call: LocalCommandCall = async (args: string) => {
  const tokens = (args ?? '').trim().split(/\s+/).filter(Boolean)
  const compact = tokens.includes('--compact')
  const baseUrl = tokens.find(token => !token.startsWith('--'))

  return {
    type: 'text',
    value: formatA2AAgentCard({ baseUrl }, !compact),
  }
}
