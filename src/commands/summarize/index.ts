/** /summarize */
import type { Command } from '../../types/command.js'
const summarize = {
  type: 'local',
  name: 'summarize',
  description: 'Read a file so UR can summarize it',
  argumentHint: '<file>',
  supportsNonInteractive: true,
  load: () => import('./summarize.js'),
} satisfies Command
export default summarize
