import type { Command } from '../../types/command.js'

const memorySuggest = {
  type: 'local',
  name: 'memory-suggest',
  aliases: ['suggest-memory'],
  description:
    'Propose durable facts from this session that are not already remembered',
  argumentHint: '[--turns <n>] [--min-confidence <0-1>]',
  supportsNonInteractive: true,
  load: () => import('./memory-suggest.js'),
} satisfies Command

export default memorySuggest
