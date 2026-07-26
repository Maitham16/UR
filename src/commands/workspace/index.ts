/** /workspace */
import type { Command } from '../../types/command.js'

const workspace = {
  type: 'local',
  name: 'workspace',
  description:
    'Show workspace info or coordinate dependency-aware work across repositories',
  argumentHint: '[init|add|task|show|validate|run|status|verify|pr-plan|rollback-plan]',
  supportsNonInteractive: true,
  load: () => import('./workspace.js'),
} satisfies Command

export default workspace
