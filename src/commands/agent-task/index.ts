import type { Command } from '../../types/command.js'

const agentTask = {
  type: 'local',
  name: 'agent-task',
  aliases: ['task-pr'],
  description: 'Summarize task state, git diff status, and PR handoff commands',
  argumentHint: 'status|diff|pr [--create] [--dry-run] [--json]',
  supportsNonInteractive: true,
  load: () => import('./agent-task.js'),
} satisfies Command

export default agentTask
