import type { Command } from '../../commands.js'

const localFirst = {
  type: 'local',
  name: 'local-first',
  aliases: ['offline-readiness', 'local'],
  description:
    'Show UR local-first readiness for no-cloud, private, lab, offline, and edge/server environments',
  argumentHint: '[--json]',
  supportsNonInteractive: true,
  load: () => import('./local-first.js'),
} satisfies Command

export default localFirst
