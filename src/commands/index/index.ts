/** /index */
import type { Command } from '../../types/command.js'
const indexCmd = {
  type: 'local',
  name: 'index',
  description: 'Build a workspace file index (.ur/index)',
  argumentHint: '',
  supportsNonInteractive: true,
  load: () => import('./index.impl.js'),
} satisfies Command
export default indexCmd
