import type { Command } from '../../types/command.js'

const learn = {
  type: 'local',
  name: 'learn',
  description:
    'Continual learning: mine artifacts/CI outcomes into a per-category/per-model success-rate store and reflective lessons that tune escalate, arena, and model-route',
  argumentHint: 'run|stats|apply [--reflect] [--dry-run] [--json]',
  supportsNonInteractive: true,
  load: () => import('./learn.js'),
} satisfies Command

export default learn
