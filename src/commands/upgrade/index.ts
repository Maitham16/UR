import type { Command } from '../../commands.js'
import { getSubscriptionType } from '../../utils/auth.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { isNetworkRestricted } from '../../utils/offlineMode.js'

const upgrade = {
  type: 'local-jsx',
  name: 'upgrade',
  description: 'Upgrade to Max for higher rate limits and more modelO',
  // Ungated: the 'ur-ai' availability requirement was unsatisfiable — it
  // needs the 'subscription' provider, which the registry blocks as an
  // internal placeholder, so no user could ever see this command.
  isEnabled: () =>
    !isEnvTruthy(process.env.DISABLE_UPGRADE_COMMAND) &&
    getSubscriptionType() !== 'enterprise' &&
    !isNetworkRestricted(),
  load: () => import('./upgrade.js'),
} satisfies Command

export default upgrade
