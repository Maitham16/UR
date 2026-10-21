import type { Command } from '../../types/command.js'

const semanticMemory = {
  type: 'local',
  name: 'semantic-memory',
  aliases: ['memory-index'],
  description: 'Search current memory bodies with hybrid recall and source provenance',
  argumentHint: 'build|search|status [query] [--json] [--lexical]',
  supportsNonInteractive: true,
  load: () => import('./semantic-memory.js'),
} satisfies Command

export default semanticMemory
