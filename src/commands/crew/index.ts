import type { Command } from '../../types/command.js'

const crew = {
  type: 'local',
  name: 'crew',
  aliases: ['crews'],
  description:
    'Headless agent crew: a lead splits a goal into a shared task board that worker subagents claim and run',
  argumentHint:
    'create|list|plan|show|add|run|reset|delete [name] [--goal ...] [--task ...] [--workers N] [--dynamic] [--max-workers N] [--max-attempts N] [--retry-backoff-ms N] [--worktrees] [--dry-run] [--resume] [--decompose] [--max-turns N] [--skip-permissions] [--json]',
  supportsNonInteractive: true,
  load: () => import('./crew.js'),
} satisfies Command

export default crew
