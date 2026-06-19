/** /forget */
import type { Command } from '../../types/command.js'

const forget = {
  type: 'local',
  name: 'forget',
  description: 'Remove memory notes matching text',
  argumentHint: '<text>',
  supportsNonInteractive: true,
  load: () => import('./forget.js'),
} satisfies Command

export default forget
