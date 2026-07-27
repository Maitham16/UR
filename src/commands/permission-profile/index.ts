import type { Command } from '../../types/command.js'

const permissionProfile = {
  type: 'local',
  name: 'permission-profile',
  aliases: ['profile'],
  description:
    'List, switch, or clear the active named permission profile',
  argumentHint: '[list | use <name> | clear]',
  supportsNonInteractive: true,
  load: () => import('./permission-profile.js'),
} satisfies Command

export default permissionProfile
