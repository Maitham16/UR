import type { Command } from '../../types/command.js'

const a2aCard = {
  type: 'local',
  name: 'a2a-card',
  aliases: ['agent-card'],
  description: 'Print UR Agent Card metadata for A2A discovery',
  argumentHint: '[base-url]',
  supportsNonInteractive: true,
  load: () => import('./a2a-card.js'),
} satisfies Command

export default a2aCard
