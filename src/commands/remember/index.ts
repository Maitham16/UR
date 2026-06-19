/** /remember */
import type { Command } from '../../types/command.js'

const remember = {
  type: 'local',
  name: 'remember',
  description: 'Save a fact/preference to UR memory',
  argumentHint: '<text>',
  supportsNonInteractive: true,
  load: () => import('./remember.js'),
} satisfies Command

export default remember
