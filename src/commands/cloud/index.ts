/** /cloud — detached best-of-N task platform (local-first codex-cloud analogue). */
import type { Command } from '../../types/command.js'
const cloudCmd = {
  type: 'local',
  name: 'cloud',
  description:
    'Detached best-of-N tasks: race N isolated agents in the background, browse results, apply the winner',
  argumentHint:
    'run "<task>" [--attempts N] [--model m] [--max-turns n] | list | show <id> | apply <id> | worker <id> [--json]',
  supportsNonInteractive: true,
  load: () => import('./cloud.js'),
} satisfies Command
export default cloudCmd
