import type { Command } from '../../commands.js'
import { isPolicyAllowed } from '../../services/policyLimits/index.js'
import { isURAISubscriber } from '../../utils/auth.js'
import { isNetworkRestricted } from '../../utils/offlineMode.js'

export default {
  type: 'local-jsx',
  name: 'remote-env',
  description: 'Configure the default remote environment for teleport sessions',
  isEnabled: () =>
    isURAISubscriber() && isPolicyAllowed('allow_remote_sessions') && !isNetworkRestricted(),
  get isHidden() {
    return !isURAISubscriber() || !isPolicyAllowed('allow_remote_sessions') || isNetworkRestricted()
  },
  load: () => import('./remote-env.js'),
} satisfies Command
