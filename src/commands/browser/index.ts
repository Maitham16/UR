/** /browser — Playwright-aware browser pilot (falls back to /chrome). */
import type { Command } from '../../types/command.js'
import { isNetworkRestricted } from '../../utils/offlineMode.js'
const browser = {
  type: 'local',
  name: 'browser',
  description: 'Browser pilot (Playwright when installed; otherwise use /chrome)',
  argumentHint: '<url|task>',
  supportsNonInteractive: true,
  isEnabled: () => !isNetworkRestricted(),
  load: () => import('./browser.js'),
} satisfies Command
export default browser
