/** /evidence — show the stability evidence/action ledger (alias of /stability evidence). */
import type { Command } from '../../types/command.js'

const evidence = {
  type: 'local',
  name: 'evidence',
  description: 'Show the stability evidence/action ledger',
  argumentHint: '[n]',
  supportsNonInteractive: true,
  load: () => import('./evidence.js'),
} satisfies Command

export default evidence
