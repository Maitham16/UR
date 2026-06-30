import type { Command } from '../../types/command.js'

const evals = {
  type: 'local',
  name: 'eval',
  aliases: ['evals'],
  description:
    'Public agent eval harness: init, list, validate, run, report, compare, route, built-in benchmarks, leaderboard, and benchmark adapters',
  argumentHint:
    '[init|list|validate|run|report|compare|route|builtin|leaderboard|bench] [suite|adapter|labels...] [--file <jsonl>] [--model <m>] [--strategy auto|cheap|strong|default] [--repeat <n>] [--format html|json|md] [--dry-run] [--category <c>] [--json] [--metrics] [--dashboard]',
  supportsNonInteractive: true,
  load: () => import('./eval.js'),
} satisfies Command

export default evals
