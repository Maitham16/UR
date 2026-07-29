import type { Command } from '../../types/command.js'

const skill = {
  type: 'local',
  name: 'skill',
  description:
    'Executable skill workflows: list, show, run, approve, reset, init, verify, sign, keygen',
  argumentHint:
    '[list|show|run|approve|reset|init|verify|sign|keygen] [name] [args] [--dry-run] [--resume] [--max-turns N] [--skip-permissions] [--require-trusted] [--key PATH] [--key-id ID] [--out PATH] [--json]',
  supportsNonInteractive: true,
  load: () => import('./skill.js'),
} satisfies Command

export default skill
