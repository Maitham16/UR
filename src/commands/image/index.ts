/** /image */
import type { Command } from '../../types/command.js'
const imageCmd = {
  type: 'local',
  name: 'image',
  description: 'Inspect an image (vision/OCR are deps-aware)',
  argumentHint: '<file> [task]',
  supportsNonInteractive: true,
  load: () => import('./image.js'),
} satisfies Command
export default imageCmd
