/** /cite */
import type { Command } from '../../types/command.js'

const cite = {
  type: 'local',
  name: 'cite',
  description: 'Add or list citations',
  argumentHint: '[citation]',
  supportsNonInteractive: true,
  load: () => import('./cite.js'),
} satisfies Command

export default cite
