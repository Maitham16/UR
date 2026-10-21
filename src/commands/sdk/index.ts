import type { Command } from '../../types/command.js'

const sdk = {
  type: 'local',
  name: 'sdk',
  aliases: ['embed'],
  description:
    'Use supported Node/Python clients for local and remote events, approvals, cancellation and resume',
  argumentHint: 'info|init [--force] [--json]',
  supportsNonInteractive: true,
  load: () => import('./sdk.js'),
} satisfies Command

export default sdk
