import type { Command } from '../../types/command.js'

const evals = {
  type: 'local',
  name: 'eval',
  aliases: ['evals'],
  description:
    'Public agent eval harness: init, list, validate, run, report, benchmark adapters',
  argumentHint:
    '[init|list|validate|run|report|bench] [suite|adapter] [--file <jsonl>] [--dry-run] [--category <c>] [--json]',
  supportsNonInteractive: true,
  load: () => import('./eval.js'),
} satisfies Command

export default evals
