import type { Command } from '../../types/command.js'

const ciLoop = {
  type: 'local',
  name: 'ci-loop',
  aliases: ['heal'],
  description:
    'Self-healing CI: run a build/test command and, on failure, capture the error, fix it, and re-run with bounded retries',
  argumentHint:
    '[--command "bun test"] [--max-attempts 3] [--commit] [--push] [--from-log <file>] [--dry-run] [--json] [--allow-generated]',
  supportsNonInteractive: true,
  load: () => import('./ci-loop.js'),
} satisfies Command

export default ciLoop
