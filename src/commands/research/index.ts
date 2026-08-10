/** /research */
import type { Command } from '../../types/command.js'

const research = {
  type: 'local',
  name: 'research',
  aliases: ['deep-research'],
  description: 'Build source-backed research workspaces with claims, corroboration checks, and reports',
  argumentHint: 'init|source|finding|question|list|show|verify|report [options]',
  supportsNonInteractive: true,
  load: () => import('./research.js'),
} satisfies Command

export default research
