import type { Command } from '../../commands.js'
import { isFastModeEnabled } from '../../utils/fastMode.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'

const fast = {
  type: 'local-jsx',
  name: 'fast',
  get description() {
    return 'Choose standard or fast speed for supported native models'
  },
  isEnabled: () => isFastModeEnabled(),
  get isHidden() {
    return !isFastModeEnabled()
  },
  argumentHint: '[on|off|status]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./fast.js'),
} satisfies Command

export default fast
