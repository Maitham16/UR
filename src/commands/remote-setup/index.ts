import type { Command } from '../../commands.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { isPolicyAllowed } from '../../services/policyLimits/index.js'

const web = {
  type: 'local-jsx',
  name: 'web-setup',
  description:
    'Setup UR on the web (requires connecting your GitHub account)',
  // Ungated: the 'ur-ai' availability requirement was unsatisfiable — it
  // needs the 'subscription' provider, which the registry blocks as an
  // internal placeholder, so no user could ever see this command.
  isEnabled: () =>
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_cobalt_lantern', false) &&
    isPolicyAllowed('allow_remote_sessions'),
  get isHidden() {
    return !isPolicyAllowed('allow_remote_sessions')
  },
  load: () => import('./remote-setup.js'),
} satisfies Command

export default web
