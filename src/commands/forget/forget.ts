import type { LocalCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { forget } from '../../ur/notes.js'
export const call: LocalCommandCall = async (args: string) => {
  const text = (args ?? '').trim()
  if (!text) return { type: 'text', value: 'usage: /forget <text>' }
  const n = forget(getCwd(), text)
  return { type: 'text', value: n > 0 ? `forgot ${n} note(s) matching "${text}"` : `no notes matched "${text}"` }
}
