/** /vuln — security toolkit (alias into /security). */
import type { Command } from '../../types/command.js'
const vulnCmd = {
  type: 'local',
  name: 'vuln',
  description: 'Dependency vulnerability audit (OSV)',
  supportsNonInteractive: true,
  load: () => import('./vuln.js'),
} satisfies Command
export default vulnCmd
