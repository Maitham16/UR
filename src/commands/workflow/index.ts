import type { Command } from '../../types/command.js'

const workflow = {
  type: 'local',
  name: 'workflow',
  aliases: ['workflows', 'wf'],
  description:
    'Declarative agent workflows: init, list, show, validate, graph, plan, run, next, done, reset',
  argumentHint: '[init|list|show|validate|graph|run|plan|next|done|reset] [name] [stepId] [--dry-run] [--resume] [--ascii] [--json]',
  supportsNonInteractive: true,
  load: () => import('./workflow.js'),
} satisfies Command

export default workflow
