import type { Command } from '../../types/command.js'

const modelDoctor = {
  type: 'local',
  name: 'model-doctor',
  aliases: ['model-capabilities'],
  description: 'Inspect local Ollama models and report likely agent capabilities',
  argumentHint: '[model] [--json]',
  supportsNonInteractive: true,
  load: () => import('./model-doctor.js'),
} satisfies Command

export default modelDoctor
