import type { Command } from '../../types/command.js'

const browserQa = {
  type: 'local',
  name: 'browser-qa',
  description: 'Execute browser QA assertions with viewport screenshots and traces',
  argumentHint: 'list|validate|run [fixture] [--dry-run] [--json]',
  supportsNonInteractive: true,
  load: () => import('./browser-qa.js'),
} satisfies Command

export default browserQa
