import type { Command } from '../../types/command.js'

const codeIndex = {
  type: 'local',
  name: 'code-index',
  aliases: ['codeindex'],
  description:
    'Build and query current code with text, symbols, dependencies, and optional local embeddings',
  argumentHint: 'build|watch|search|status|repo [query] [--graph] [--repo] [--dry-run] [--json] [--lexical] [--max-files=N]',
  supportsNonInteractive: true,
  load: () => import('./code-index.js'),
} satisfies Command

export default codeIndex
