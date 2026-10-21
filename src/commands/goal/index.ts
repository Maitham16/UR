import type { Command } from '../../types/command.js'

const goal = {
  type: 'local',
  name: 'goal',
  aliases: ['goals'],
  description:
    'Advance persistent goals with model-directed strategy, aggregate budgets and verified outcomes',
  argumentHint:
    'add|list|show|note|resume|pause|done|abandon|delete [name] [--objective ...] [--workflow ...] [--json]',
  supportsNonInteractive: true,
  load: () => import('./goal.js'),
} satisfies Command

export default goal
