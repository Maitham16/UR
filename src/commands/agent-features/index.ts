import type { Command } from '../../types/command.js'

const agentFeatures = {
  type: 'local',
  name: 'agent-features',
  aliases: ['agent-roadmap'],
  description: 'Show or initialize UR agent feature expansion scaffolds',
  argumentHint: '[init] [--json] [--force]',
  supportsNonInteractive: true,
  load: () => import('./agent-features.js'),
} satisfies Command

export default agentFeatures
