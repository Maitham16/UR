/** /threat-model — security toolkit (alias into /security). */
import type { Command } from '../../types/command.js'
const threatModel = {
  type: 'local',
  name: 'threat-model',
  description: 'Generate a STRIDE/ATT&CK threat model',
  supportsNonInteractive: true,
  load: () => import('./threat-model.js'),
} satisfies Command
export default threatModel
