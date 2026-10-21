import type { Command } from '../../types/command.js'

const modelDoctor = {
  type: 'local',
  name: 'model-doctor',
  aliases: ['model-capabilities'],
  description: 'Inspect model capabilities and measure the selected provider with optional live probes',
  argumentHint: '[model] [--provider provider] [--probe|--profile] [--timeout-ms N] [--json]',
  supportsNonInteractive: true,
  load: () => import('./model-doctor.js'),
} satisfies Command

export default modelDoctor
