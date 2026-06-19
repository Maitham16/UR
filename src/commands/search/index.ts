/** /search */
import type { Command } from '../../types/command.js'
const searchCmd = {
  type: 'local',
  name: 'search',
  description: 'Search workspace files for text',
  argumentHint: '<query>',
  supportsNonInteractive: true,
  load: () => import('./search.js'),
} satisfies Command
export default searchCmd
