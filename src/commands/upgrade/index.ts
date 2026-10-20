import type { Command } from '../../commands.js'
import { getSubscriptionType } from '../../utils/auth.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { isNetworkRestricted } from '../../utils/offlineMode.js'

const upgrade = {
  type: 'local-jsx',
  name: 'upgrade',
  description: 'Manage an explicitly configured UR subscription',
  // Public distributions have no independent subscription backend. Keep this
  // account flow internal until a real public service is configured.
  isEnabled: () =>
    process.env.USER_TYPE === 'ant' &&
    !isEnvTruthy(process.env.DISABLE_UPGRADE_COMMAND) &&
    getSubscriptionType() !== 'enterprise' &&
    !isNetworkRestricted(),
  load: () => import('./upgrade.js'),
} satisfies Command

export default upgrade
