import type { Command } from '../../types/command.js'

const claimLedger = {
  type: 'local',
  name: 'claim-ledger',
  aliases: ['claims'],
  description: 'Manage project claim-to-source provenance ledger',
  argumentHint: 'add|list|validate [--claim text] [--source kind:ref] [--json]',
  supportsNonInteractive: true,
  load: () => import('./claim-ledger.js'),
} satisfies Command

export default claimLedger
