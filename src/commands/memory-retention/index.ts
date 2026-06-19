import type { Command } from '../../types/command.js'

const memoryRetention = {
  type: 'local',
  name: 'memory-retention',
  aliases: ['retention'],
  description: 'Configure and apply local UR memory retention policies',
  argumentHint: 'show|set|prune [--ttl-days N] [--max-entries N] [--decay-days N] [--json]',
  supportsNonInteractive: true,
  load: () => import('./memory-retention.js'),
} satisfies Command

export default memoryRetention
