import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { LocalCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
export const call: LocalCommandCall = async (args: string) => {
  const task = (args ?? '').trim()
  if (!task) return { type: 'text', value: 'usage: /browser <url|task>' }
  const hasPlaywright = existsSync(join(getCwd(), 'node_modules', 'playwright')) || existsSync(join(getCwd(), 'node_modules', 'playwright-core'))
  if (hasPlaywright) {
    return { type: 'text', value: `Playwright detected — ask UR to drive the browser for: ${task}\nRisky actions (form submit, downloads, login) require your approval.` }
  }
  return {
    type: 'text',
    value: `Playwright not installed.\n  • install: bun add -d playwright && bunx playwright install chromium\n  • or use the built-in /chrome automation for: ${task}`,
  }
}
