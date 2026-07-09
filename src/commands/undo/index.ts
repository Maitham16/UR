import type { Command } from '../../commands.js'

const undo = {
  description: `Undo the last file edit by restoring the most recently modified file to its pre-edit state`,
  name: 'undo',
  argumentHint: '',
  type: 'local',
  supportsNonInteractive: false,
  load: () => import('./undo.js'),
} satisfies Command

export default undo