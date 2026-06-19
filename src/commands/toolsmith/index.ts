/** /toolsmith — scaffold a local helper tool into .ur/tools/. */
import type { Command } from '../../types/command.js'
const toolsmith = {
  type: 'local',
  name: 'toolsmith',
  description: 'Scaffold a local helper tool (.ur/tools); run it via UR with approval',
  argumentHint: '<name> <python|bash|node|go|rust>',
  supportsNonInteractive: true,
  load: () => import('./toolsmith.js'),
} satisfies Command
export default toolsmith
