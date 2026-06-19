import type { Command } from '../../types/command.js'

const codeIndex = {
  type: 'local',
  name: 'code-index',
  aliases: ['codeindex'],
  description:
    'Build and query a local semantic code index (embeddings via the local Ollama app)',
  argumentHint: 'build|watch|search|status [query] [--graph] [--dry-run] [--json]',
  supportsNonInteractive: true,
  load: () => import('./code-index.js'),
} satisfies Command

export default codeIndex
