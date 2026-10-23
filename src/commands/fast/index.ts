import type { Command } from '../../commands.js'
import { isFastModeEnabled } from '../../utils/fastMode.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'

const fast = {
  type: 'local-jsx',
  name: 'fast',
  get description() {
    return 'Choose the model’s supported serving tier or provider routing preference'
  },
  isEnabled: () => isFastModeEnabled(),
  get isHidden() {
    return !isFastModeEnabled()
  },
  argumentHint: '[on|off|status|auto|standard|fast|ultrafast|priority|flex|latency|throughput|price]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./fast.js'),
} satisfies Command

export default fast
