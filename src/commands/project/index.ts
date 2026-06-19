/** /project */
import type { Command } from '../../types/command.js'

const project = {
  type: 'local',
  name: 'project',
  description: 'Show project summary (workspace + DNA)',
  argumentHint: '',
  // Hidden — duplicate of /workspace. Still works if typed.
  isHidden: true,
  supportsNonInteractive: true,
  load: () => import('./project.js'),
} satisfies Command

export default project
