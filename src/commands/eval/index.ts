import type { Command } from '../../types/command.js'

const evals = {
  type: 'local',
  name: 'eval',
  aliases: ['evals'],
  description:
    'Isolated agent evals with redacted trajectories, persisted scores, reliability reports, and CI gates',
  argumentHint:
    '[init|list|validate|run|optimize|report|gate|compare|route|builtin|leaderboard|bench] [suite] [--model m|--models m1,m2] [--efforts low,high] [--repeat n] [--judge-model m] [--no-isolate] [gate thresholds] [--json]',
  supportsNonInteractive: true,
  load: () => import('./eval.js'),
} satisfies Command

export default evals
