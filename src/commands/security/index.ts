/**
 * /security — defensive security toolkit (ported from the 309 agent).
 * Metadata only; the implementation is lazy-loaded from security.ts.
 */
import type { Command } from '../../types/command.js'

const security = {
  type: 'local',
  name: 'security',
  description:
    'Security toolkit: audit, scan, secrets, code review, threat-model, vuln, scope, IR, playbooks',
  argumentHint:
    'scan | code | secrets | threat-model | vuln | scope set local | status | rules | report',
  supportsNonInteractive: true,
  load: () => import('./security.js'),
} satisfies Command

export default security
