/** /research */
import type { Command } from '../../types/command.js'

const research = {
  type: 'local',
  name: 'research',
  description: 'Add or list research notes',
  argumentHint: '[note text]',
  supportsNonInteractive: true,
  load: () => import('./research.js'),
} satisfies Command

export default research
