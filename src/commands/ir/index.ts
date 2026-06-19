/** /ir — security toolkit (alias into /security). */
import type { Command } from '../../types/command.js'
const irCmd = {
  type: 'local',
  name: 'ir',
  description: 'Incident-response collection (read-only)',
  supportsNonInteractive: true,
  load: () => import('./ir.js'),
} satisfies Command
export default irCmd
