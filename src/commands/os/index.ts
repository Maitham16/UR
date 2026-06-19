/** /os */
import type { Command } from '../../types/command.js'

const os = {
  type: 'local',
  name: 'os',
  description: 'Show OS, shell, runtime, and detected tools',
  argumentHint: '',
  supportsNonInteractive: true,
  load: () => import('./os.js'),
} satisfies Command

export default os
