/** /pdf */
import type { Command } from '../../types/command.js'
const pdfCmd = {
  type: 'local',
  name: 'pdf',
  description: 'Extract text and metadata from a PDF so UR can work with it (pdftotext-aware)',
  argumentHint: '<file> [pages] [task]',
  supportsNonInteractive: true,
  load: () => import('./pdf.js'),
} satisfies Command
export default pdfCmd
