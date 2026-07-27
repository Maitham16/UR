import type { Command } from '../../commands.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

const installGitHubApp = {
  type: 'local-jsx',
  name: 'install-github-app',
  description: 'Set up UR GitHub Actions for a repository',
  // Deliberately ungated: this provisions a workflow and a repository secret
  // rather than consuming inference, and the key is entered by hand in the
  // flow, so it is useful on every provider including local runtimes.
  isEnabled: () => !isEnvTruthy(process.env.DISABLE_INSTALL_GITHUB_APP_COMMAND),
  load: () => import('./install-github-app.js'),
} satisfies Command

export default installGitHubApp
