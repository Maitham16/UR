import type { Command } from '../../types/command.js'

const workflow = {
  type: 'local',
  name: 'workflow',
  aliases: ['workflows', 'wf'],
  description:
    'Declarative agent workflows: init, list, show, validate, graph, plan, run, next, approve, done, reset',
  argumentHint:
    '[init|list|show|validate|graph|run|plan|next|approve|done|reset] [name] [stepId] [--dry-run] [--resume] [--max-turns N] [--concurrency N] [--live] [--skip-permissions] [--ascii] [--json]',
  supportsNonInteractive: true,
  load: () => import('./workflow.js'),
} satisfies Command

export default workflow
