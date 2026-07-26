import type { Command } from '../../types/command.js'

const learn = {
  type: 'local',
  name: 'learn',
  description:
    'Continual learning: mine outcomes and promote evidence-backed reusable workflow playbooks',
  argumentHint:
    'run|stats|apply|playbooks mine|list|show|approve|reject|disable|run [--json]',
  supportsNonInteractive: true,
  load: () => import('./learn.js'),
} satisfies Command

export default learn
