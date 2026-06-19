/** /scope — security toolkit (alias into /security). */
import type { Command } from '../../types/command.js'
const scopeCmd = {
  type: 'local',
  name: 'scope',
  description: 'Define/approve an authorized security test scope',
  supportsNonInteractive: true,
  load: () => import('./scope.js'),
} satisfies Command
export default scopeCmd
