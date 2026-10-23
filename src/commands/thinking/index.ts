import type { Command } from '../../commands.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'

export default {
  type: 'local-jsx',
  name: 'thinking',
  description: 'Control native thinking or a supported model token budget',
  argumentHint: '[on|off|toggle|status|budget N|budget auto|budget default]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./thinking.js'),
} satisfies Command
