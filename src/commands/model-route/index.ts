import type { Command } from '../../types/command.js'

const modelRoute = {
  type: 'local',
  name: 'model-route',
  aliases: ['model-pick'],
  description:
    'Recommend and resolve the best model for a task using local capabilities and cheap/strong/default pools',
  argumentHint: '<task...> [--strategy auto|cheap|strong|default] [--json]',
  supportsNonInteractive: true,
  load: () => import('./model-route.js'),
} satisfies Command

export default modelRoute
