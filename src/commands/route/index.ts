import type { Command } from '../../types/command.js'

const route = {
  type: 'local',
  name: 'route',
  aliases: ['intent'],
  description:
    'Classify a task and recommend the best subagent and collaboration pattern',
  argumentHint: '<task...> [--json]',
  supportsNonInteractive: true,
  load: () => import('./route.js'),
} satisfies Command

export default route
