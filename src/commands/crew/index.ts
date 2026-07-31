import type { Command } from '../../types/command.js'

const crew = {
  type: 'local',
  name: 'crew',
  aliases: ['crews'],
  description:
    'Headless agent crew: a lead splits a goal into a shared task board that worker subagents claim and run',
  argumentHint:
    'create|list|plan|show|add|run|reset|delete [name] [--goal ...] [--task ...] [--workers N] [--worktrees] [--dry-run] [--decompose] [--json]',
  supportsNonInteractive: true,
  load: () => import('./crew.js'),
} satisfies Command

export default crew
