/** /mode — view or set UR's working mode (persisted to .ur/mode). */
import type { Command } from '../../types/command.js'
const mode = {
  type: 'local',
  name: 'mode',
  description: 'View or set the working mode (code, research, debug, browser, image, video, data)',
  argumentHint: '[code|research|debug|browser|image|video|data]',
  supportsNonInteractive: true,
  load: () => import('./mode.js'),
} satisfies Command
export default mode
