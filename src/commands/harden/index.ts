/** /harden — security toolkit (alias into /security). */
import type { Command } from '../../types/command.js'
const hardenCmd = {
  type: 'local',
  name: 'harden',
  description: 'System hardening checks (read-only)',
  supportsNonInteractive: true,
  load: () => import('./harden.js'),
} satisfies Command
export default hardenCmd
