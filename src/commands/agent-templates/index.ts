import type { Command } from '../../types/command.js'

const agentTemplates = {
  type: 'local',
  name: 'agent-templates',
  aliases: ['agent-template'],
  description: 'List or install reusable project agent templates',
  argumentHint: '[list|install] [name...] [--force] [--json]',
  supportsNonInteractive: true,
  load: () => import('./agent-templates.js'),
} satisfies Command

export default agentTemplates
