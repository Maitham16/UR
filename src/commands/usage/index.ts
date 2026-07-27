import type { Command } from '../../commands.js'

export default {
  type: 'local-jsx',
  name: 'usage',
  description: 'Show plan usage limits',
  // Ungated: the 'ur-ai' availability requirement was unsatisfiable — it
  // needs the 'subscription' provider, which the registry blocks as an
  // internal placeholder, so no user could ever see this command.
  load: () => import('./usage.js'),
} satisfies Command
