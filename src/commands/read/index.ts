/** /read */
import type { Command } from '../../types/command.js'
const read = {
  type: 'local',
  name: 'read',
  description: 'Read a text-like file from the workspace',
  argumentHint: '<file>',
  supportsNonInteractive: true,
  load: () => import('./read.js'),
} satisfies Command
export default read
