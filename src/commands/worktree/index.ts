import type { Command } from '../../types/command.js'

const worktree = {
  type: 'local',
  name: 'worktree',
  aliases: ['worktrees'],
  description: 'List, inspect, and clean up UR agent worktrees',
  argumentHint: 'list|status|clean [--json]',
  supportsNonInteractive: true,
  load: () => import('./worktree.js'),
} satisfies Command

export default worktree
