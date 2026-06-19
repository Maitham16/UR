import type { Command } from '../../types/command.js'

const bg = {
  type: 'local',
  name: 'bg',
  aliases: ['background-agent'],
  description:
    'Run and manage detached local UR background agents with optional worktrees and PR creation',
  argumentHint:
    'run|fanout|list|status|logs|attach|kill|worker "<task>" [--worktree] [--pr] [--agents N] [--json]',
  supportsNonInteractive: true,
  load: () => import('./bg.js'),
} satisfies Command

export default bg
