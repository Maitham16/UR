import type { Command } from '../../types/command.js'

const escalate = {
  type: 'local',
  name: 'escalate',
  description:
    'Capability-aware local model escalation: run on a fast model and auto-escalate hard work to a strong "oracle" model',
  argumentHint:
    'plan|run|oracle|policy "<task>" [--dry-run] [--force-oracle] [--fast m] [--oracle m] [--json]',
  supportsNonInteractive: true,
  load: () => import('./escalate.js'),
} satisfies Command

export default escalate
