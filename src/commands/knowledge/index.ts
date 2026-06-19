import type { Command } from '../../types/command.js'

const knowledge = {
  type: 'local',
  name: 'knowledge',
  aliases: ['kb'],
  description:
    'Curated project knowledge base with provenance: add, remove, build, search, list, prune, status',
  argumentHint: '[add|remove|build|search|list|prune|status] [ref|query...] [--note] [--label <l>] [--embeddings] [--embed-model <m>] [--older-than <days>] [--json]',
  supportsNonInteractive: true,
  load: () => import('./knowledge.js'),
} satisfies Command

export default knowledge
