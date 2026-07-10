import type { Command } from '../../types/command.js'

const ciLoop = {
  type: 'local',
  name: 'ci-loop',
  aliases: ['heal'],
  description:
    'CI agent: run a build/test command, fix failures, rerun until green, or prove cannot-fix with command evidence',
  argumentHint:
    '[--command "bun test|pytest|npm run build"] [--cwd <path>] [--max-attempts 3] [--commit] [--push] [--from-log <file>] [--dry-run] [--json] [--allow-generated] [--allow-delete]',
  whenToUse:
    'Use `ur ci-loop --command "bun test"`, `ur ci-loop --command "pytest"`, or `ur ci-loop --command "npm run build"` when UR should act as a CI agent: run the command, fix failures, rerun, and stop only when green or when it can prove why it cannot fix the failure.',
  supportsNonInteractive: true,
  load: () => import('./ci-loop.js'),
} satisfies Command

export default ciLoop
