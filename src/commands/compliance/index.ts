/** /compliance — security toolkit (alias into /security). */
import type { Command } from '../../types/command.js'
const complianceCmd = {
  type: 'local',
  name: 'compliance',
  description: 'Compliance mapping (OWASP / SSDF / CIS)',
  supportsNonInteractive: true,
  load: () => import('./compliance.js'),
} satisfies Command
export default complianceCmd
