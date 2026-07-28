import type { Command } from '../../types/command.js'

const gradeTrajectory = {
  type: 'local',
  name: 'grade-trajectory',
  aliases: ['grade'],
  description:
    'Grade a run on how it worked, not just what it concluded: tool choice, verification, safety, efficiency',
  argumentHint: '--file <transcript.jsonl> [--min-score <n>] [--json]',
  whenToUse:
    'Use `ur grade-trajectory --file <transcript.jsonl> --min-score 70` in CI to fail a run that edited files without verifying, issued destructive commands, or looped on identical failures.',
  supportsNonInteractive: true,
  load: () => import('./grade-trajectory.js'),
} satisfies Command

export default gradeTrajectory
