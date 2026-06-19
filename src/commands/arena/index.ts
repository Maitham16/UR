import type { Command } from '../../types/command.js'

const arena = {
  type: 'local',
  name: 'arena',
  aliases: ['best-of'],
  description:
    'Run N agents on the same task in isolated worktrees, judge the diffs, and surface (optionally apply) the winner',
  argumentHint:
    '"<task>" [--agents N] [--apply] [--keep] [--dry-run] [--max-turns N] [--skip-permissions] [--json]',
  supportsNonInteractive: true,
  load: () => import('./arena.js'),
} satisfies Command

export default arena
