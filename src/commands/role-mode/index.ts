/** /role-mode — list/show/install built-in role modes (Architect, Code, Debug, Ask). */
import type { Command } from '../../types/command.js'

const roleMode = {
  type: 'local',
  name: 'role-mode',
  aliases: ['roles', 'rolemode'],
  description:
    'List, show, or install built-in role modes (Architect, Code, Debug, Ask) as scoped agents',
  argumentHint: 'list|show <name>|install <name|all> [--force] [--json]',
  supportsNonInteractive: true,
  load: () => import('./role-mode.js'),
} satisfies Command

export default roleMode
