import type { Command } from '../../types/command.js'

const automation = {
  type: 'local',
  name: 'automation',
  aliases: ['automations'],
  description: 'Manage project-local UR automation specs',
  argumentHint:
    'list|create|show|run|run-due|enable|disable|delete [name] [--json]',
  supportsNonInteractive: true,
  load: () => import('./automation.js'),
} satisfies Command

export default automation
