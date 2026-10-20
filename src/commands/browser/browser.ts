import type { LocalCommandCall } from '../../types/command.js'
import { loadPlaywright } from '../../utils/playwrightRuntime.js'
export const call: LocalCommandCall = async (args: string) => {
  const task = (args ?? '').trim()
  if (!task) return { type: 'text', value: 'usage: /browser <url|task>' }
  try {
    await loadPlaywright()
    return { type: 'text', value: `Browser engine available — ask UR to drive Chrome, Chromium, or Edge for: ${task}\nSet PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH when using a custom browser installation. Risky actions (form submit, downloads, login) require your approval.` }
  } catch {
    return {
      type: 'text',
      value: 'Browser engine unavailable. Reinstall UR or use HTTP fetch / the /chrome integration.',
    }
  }
}
