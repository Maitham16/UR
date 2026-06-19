import type { Command } from '../../types/command.js'

const sdk = {
  type: 'local',
  name: 'sdk',
  aliases: ['embed'],
  description:
    'Show how to drive UR programmatically (headless) and scaffold TS/Python SDK examples',
  argumentHint: 'info|init [--force] [--json]',
  supportsNonInteractive: true,
  load: () => import('./sdk.js'),
} satisfies Command

export default sdk
