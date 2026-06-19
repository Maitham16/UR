/** /workspace */
import type { Command } from '../../types/command.js'

const workspace = {
  type: 'local',
  name: 'workspace',
  description: 'Show workspace path, git, and project DNA',
  argumentHint: '',
  supportsNonInteractive: true,
  load: () => import('./workspace.js'),
} satisfies Command

export default workspace
