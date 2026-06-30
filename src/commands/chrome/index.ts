import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import { isNetworkRestricted } from '../../utils/offlineMode.js'

const command: Command = {
  name: 'chrome',
  description: 'UR in Chrome (Beta) settings',
  availability: ['ur-ai'],
  isEnabled: () => !getIsNonInteractiveSession() && !isNetworkRestricted(),
  type: 'local-jsx',
  load: () => import('./chrome.js'),
}

export default command
