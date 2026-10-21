/** /ur-doctor — read-only active-provider readiness and workspace review. */
import type { Command } from '../../types/command.js'
const urDoctor = {
  type: 'local',
  name: 'ur-doctor',
  description: 'Read-only readiness and review: active provider, sandbox, diffs, current proof, costs and recovery [--json]',
  supportsNonInteractive: true,
  load: () => import('./ur-doctor.js'),
} satisfies Command
export default urDoctor
