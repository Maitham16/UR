/** /kali — security toolkit (alias into /security). */
import type { Command } from '../../types/command.js'
const kaliCmd = {
  type: 'local',
  name: 'kali',
  description: 'Detect Kali/security tools (read-only)',
  supportsNonInteractive: true,
  load: () => import('./kali.js'),
} satisfies Command
export default kaliCmd
