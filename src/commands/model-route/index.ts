import type { Command } from '../../types/command.js'

const modelRoute = {
  type: 'local',
  name: 'model-route',
  aliases: ['model-pick'],
  description:
    'Recommend the best local Ollama model for a task by capability fit',
  argumentHint: '<task...> [--json]',
  supportsNonInteractive: true,
  load: () => import('./model-route.js'),
} satisfies Command

export default modelRoute
