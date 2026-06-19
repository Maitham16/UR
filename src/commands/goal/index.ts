import type { Command } from '../../types/command.js'

const goal = {
  type: 'local',
  name: 'goal',
  aliases: ['goals'],
  description:
    'Track long-horizon objectives that persist across sessions and resume their workflow',
  argumentHint:
    'add|list|show|note|resume|pause|done|abandon|delete [name] [--objective ...] [--workflow ...] [--json]',
  supportsNonInteractive: true,
  load: () => import('./goal.js'),
} satisfies Command

export default goal
