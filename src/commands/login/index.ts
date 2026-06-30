import type { Command } from '../../commands.js'
import { hasURHQApiKeyAuth } from '../../utils/auth.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { isNetworkRestricted } from '../../utils/offlineMode.js'

export default () =>
  ({
    type: 'local-jsx',
    name: 'login',
    description: hasURHQApiKeyAuth()
      ? 'Switch URHQ accounts'
      : 'Sign in with your URHQ account',
    isEnabled: () =>
      !isEnvTruthy(process.env.DISABLE_LOGIN_COMMAND) && !isNetworkRestricted(),
    load: () => import('./login.js'),
  }) satisfies Command
