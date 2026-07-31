import type { Command } from '../../types/command.js'

const skill = {
  type: 'local',
  name: 'skill',
  description: 'Executable skill workflows: list, show, run, init',
  argumentHint: '[list|show|run|init] [name] [args] [--json] [--dry-run]',
  supportsNonInteractive: true,
  load: () => import('./skill.js'),
} satisfies Command

export default skill
