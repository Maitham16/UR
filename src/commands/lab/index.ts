/** /lab — security toolkit (alias into /security). */
import type { Command } from '../../types/command.js'
const labCmd = {
  type: 'local',
  name: 'lab',
  description: 'Create a safe local security lab',
  supportsNonInteractive: true,
  load: () => import('./lab.js'),
} satisfies Command
export default labCmd
