import type { Command } from '../../commands.js'

const installSlackApp = {
  type: 'local',
  name: 'install-slack-app',
  description: 'Install the UR Slack app',
  // Ungated: the 'ur-ai' availability requirement was unsatisfiable — it
  // needs the 'subscription' provider, which the registry blocks as an
  // internal placeholder, so no user could ever see this command.
  supportsNonInteractive: false,
  load: () => import('./install-slack-app.js'),
} satisfies Command

export default installSlackApp
