/** /create-skill */
import type { Command } from '../../types/command.js'

const createSkill = {
  type: 'local',
  name: 'create-skill',
  description: 'Scaffold a new skill (SKILL.md) in your skills directory',
  argumentHint: '<skill-name> [description] [--project]',
  aliases: ['new-skill'],
  supportsNonInteractive: true,
  load: () => import('./create-skill.js'),
} satisfies Command

export default createSkill
