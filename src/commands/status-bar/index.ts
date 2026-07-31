import type { Command } from '../../commands.js'

const statusBar = {
  type: 'local-jsx',
  name: 'status-bar',
  description: 'Choose which fields the status bar shows',
  load: () => import('./status-bar.js'),
} satisfies Command

export default statusBar
