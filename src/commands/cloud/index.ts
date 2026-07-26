/** /cloud — verified local races or managed candidate lifecycle. */
import type { Command } from '../../types/command.js'
const cloudCmd = {
  type: 'local',
  name: 'cloud',
  description:
    'Detached tasks: verified local best-of-N or managed isolated candidates with steering, eligibility selection, and recovery',
  argumentHint:
    'run "<task>" [--runner local|managed] [--attempts N] | list | sync | environments | show|logs|steer|cancel <id> | apply <id> [--json]',
  supportsNonInteractive: true,
  load: () => import('./cloud.js'),
} satisfies Command
export default cloudCmd
