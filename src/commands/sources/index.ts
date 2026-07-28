import type { Command } from '../../types/command.js'

const sources = {
  type: 'local',
  name: 'sources',
  description:
    'List every untrusted source that entered this session, or check whether a span came from one',
  argumentHint: '[--check "<span>"] [--flagged] [--json]',
  whenToUse:
    'Use `ur sources` to audit what web or MCP content the agent was given, and `ur sources --check "<span>"` to find whether a claim appears in a fetched source or was produced by the model alone.',
  supportsNonInteractive: true,
  load: () => import('./sources.js'),
} satisfies Command

export default sources
