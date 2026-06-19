import { buildAgentTrendReport, formatAgentTrendReport } from '../../services/agents/trends.js'
import type { LocalCommandCall } from '../../types/command.js'

export const call: LocalCommandCall = async (args: string) => {
  const tokens = (args ?? '').trim().split(/\s+/).filter(Boolean)
  const json = tokens.includes('--json')
  const baseUrlIndex = tokens.indexOf('--a2a-base-url')
  const baseUrl = baseUrlIndex >= 0 ? tokens[baseUrlIndex + 1] : undefined
  const report = buildAgentTrendReport({ baseUrl })

  return {
    type: 'text',
    value: json ? JSON.stringify(report, null, 2) : formatAgentTrendReport(report),
  }
}
