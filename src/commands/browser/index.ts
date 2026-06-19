/** /browser — Playwright-aware browser pilot (falls back to /chrome). */
import type { Command } from '../../types/command.js'
const browser = {
  type: 'local',
  name: 'browser',
  description: 'Browser pilot (Playwright when installed; otherwise use /chrome)',
  argumentHint: '<url|task>',
  supportsNonInteractive: true,
  load: () => import('./browser.js'),
} satisfies Command
export default browser
