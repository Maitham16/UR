/** /convert */
import type { Command } from '../../types/command.js'
const convertCmd = {
  type: 'local',
  name: 'convert',
  description: 'Convert a file to another format (deps-aware)',
  argumentHint: '<file> <target>',
  supportsNonInteractive: true,
  load: () => import('./convert.js'),
} satisfies Command
export default convertCmd
