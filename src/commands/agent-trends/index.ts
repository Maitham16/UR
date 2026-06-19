import type { Command } from '../../types/command.js'

const agentTrends = {
  type: 'local',
  name: 'agent-trends',
  aliases: ['trends'],
  description: 'Show UR coverage for current agent technology trends',
  argumentHint: '[--json]',
  supportsNonInteractive: true,
  load: () => import('./agent-trends.js'),
} satisfies Command

export default agentTrends
