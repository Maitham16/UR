import type { Command } from '../../types/command.js'

const agentInspect = {
  type: 'local',
  name: 'agent-inspect',
  aliases: ['inspect-agents'],
  description:
    'Reconstruct a per-subagent timeline (spawns, prompts, results, verdicts, tools, tokens) from this session or a transcript file',
  argumentHint: '[--file <path>] [--json]',
  supportsNonInteractive: true,
  load: () => import('./agent-inspect.js'),
} satisfies Command

export default agentInspect
