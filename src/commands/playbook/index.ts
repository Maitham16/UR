/** /playbook — security toolkit (alias into /security). */
import type { Command } from '../../types/command.js'
const playbookCmd = {
  type: 'local',
  name: 'playbook',
  description: 'Show or run a defensive security playbook',
  supportsNonInteractive: true,
  load: () => import('./playbook.js'),
} satisfies Command
export default playbookCmd
