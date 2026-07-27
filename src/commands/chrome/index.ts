import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import { isNetworkRestricted } from '../../utils/offlineMode.js'

const command: Command = {
  name: 'chrome',
  description: 'UR in Chrome (Beta) settings',
  // Ungated: the 'ur-ai' availability requirement was unsatisfiable — it
  // needs the 'subscription' provider, which the registry blocks as an
  // internal placeholder, so no user could ever see this command.
  isEnabled: () => !getIsNonInteractiveSession() && !isNetworkRestricted(),
  type: 'local-jsx',
  load: () => import('./chrome.js'),
}

export default command
