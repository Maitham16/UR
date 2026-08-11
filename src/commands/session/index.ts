import type { Command } from '../../commands.js'

const session = {
  type: 'local-jsx',
  name: 'session',
  description: 'View, archive, and restore local conversation sessions',
  argumentHint: 'status|list|archive|unarchive [session-id]',
  load: () => import('./session.js'),
} satisfies Command

export default session
