import type { Command } from '../../commands.js'

const installSlackApp = {
  type: 'local',
  name: 'install-slack-app',
  description: 'Install the UR Slack app',
  availability: ['ur-ai'],
  supportsNonInteractive: false,
  load: () => import('./install-slack-app.js'),
} satisfies Command

export default installSlackApp
