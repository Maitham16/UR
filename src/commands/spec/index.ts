import type { Command } from '../../types/command.js'

const spec = {
  type: 'local',
  name: 'spec',
  aliases: ['specs'],
  description:
    'Spec-driven development: scaffold requirements -> design -> tasks in .ur/specs and drive execution task-by-task',
  argumentHint:
    'init|list|show|generate|approve|next|run|status|delete [name] [--goal ...] [--all] [--dry-run] [--json]',
  supportsNonInteractive: true,
  load: () => import('./spec.js'),
} satisfies Command

export default spec
