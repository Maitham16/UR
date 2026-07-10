/** /thread — share session threads as local web pages. */
import type { Command } from '../../types/command.js'
const threadCmd = {
  type: 'local',
  name: 'thread',
  aliases: ['threads'],
  description:
    'Share a session transcript as a local web page teammates can open (served by the artifacts server)',
  argumentHint: 'share [sessionId] | list [--json]',
  supportsNonInteractive: true,
  load: () => import('./thread.js'),
} satisfies Command
export default threadCmd
