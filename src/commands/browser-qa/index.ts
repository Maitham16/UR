import type { Command } from '../../types/command.js'

const browserQa = {
  type: 'local',
  name: 'browser-qa',
  description: 'Validate and smoke-run browser QA replay fixtures',
  argumentHint: 'list|validate|run [fixture] [--dry-run] [--json]',
  supportsNonInteractive: true,
  load: () => import('./browser-qa.js'),
} satisfies Command

export default browserQa
