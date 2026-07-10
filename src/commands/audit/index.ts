import type { Command } from '../../commands.js'

const audit = {
  description:
    'Export a verifiable audit trail (tool actions + run traces) as hash-chained JSONL or CSV',
  name: 'audit',
  argumentHint: 'export [--format jsonl|csv] [--out <file>] | verify <file>',
  type: 'local',
  supportsNonInteractive: true,
  load: () => import('./audit.js'),
} satisfies Command

export default audit
