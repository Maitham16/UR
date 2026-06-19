/** /analyze */
import type { Command } from '../../types/command.js'
const analyzeCmd = {
  type: 'local',
  name: 'analyze',
  description: 'Read a file so UR can analyze it',
  argumentHint: '<file>',
  supportsNonInteractive: true,
  load: () => import('./analyze.js'),
} satisfies Command
export default analyzeCmd
