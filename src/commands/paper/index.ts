/** /paper */
import type { Command } from '../../types/command.js'

const paper = {
  type: 'local',
  name: 'paper',
  description: 'Add or list research papers',
  argumentHint: '[paper title or path]',
  supportsNonInteractive: true,
  load: () => import('./paper.js'),
} satisfies Command

export default paper
