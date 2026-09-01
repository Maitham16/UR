import type { Command } from '../../commands.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'

export default {
  type: 'local-jsx',
  name: 'thinking',
  description: 'Inspect or toggle provider-native thinking',
  argumentHint: '[on|off|toggle|status]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./thinking.js'),
} satisfies Command
