import type { Command } from '../../types/command.js'

const agentCi = {
  type: 'local',
  name: 'agent-ci',
  description:
    'Run policy-gated agents in isolated CI worktrees and emit safe artifacts',
  argumentHint:
    '[init|validate|workflow|run] [name] [--event path] [--event-name name] [--dry-run] [--json]',
  supportsNonInteractive: true,
  load: () => import('./agent-ci.js'),
} satisfies Command

export default agentCi
