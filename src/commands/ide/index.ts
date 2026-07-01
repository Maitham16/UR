import type { Command } from '../../commands.js'

const ide = {
  type: 'local-jsx',
  name: 'ide',
  description: 'Manage IDE integrations, status, and inline diff bundles',
  argumentHint: '[open|status|doctor|config <editor>|diff capture|diff list|diff show <id>]',
  load: () => import('./ide.js'),
} satisfies Command

export default ide
