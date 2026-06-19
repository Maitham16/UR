/** /actions — show the recent action log (alias of /stability actions). */
import type { Command } from '../../types/command.js'

const actions = {
  type: 'local',
  name: 'actions',
  description: 'Show the recent stability action log',
  argumentHint: '[n]',
  supportsNonInteractive: true,
  load: () => import('./actions.js'),
} satisfies Command

export default actions
