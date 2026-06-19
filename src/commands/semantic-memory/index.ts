import type { Command } from '../../types/command.js'

const semanticMemory = {
  type: 'local',
  name: 'semantic-memory',
  aliases: ['memory-index'],
  description: 'Build and search the project-local memory index',
  argumentHint: 'build|search|status [query] [--json]',
  supportsNonInteractive: true,
  load: () => import('./semantic-memory.js'),
} satisfies Command

export default semanticMemory
