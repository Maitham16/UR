import type { LocalCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { readFileSafe } from '../../ur/fileops.js'
export const call: LocalCommandCall = async (args: string) => {
  const f = (args ?? '').trim()
  if (!f) return { type: 'text', value: 'usage: /read <file>' }
  const r = readFileSafe(getCwd(), f)
  return { type: 'text', value: r.ok ? `# ${f}\n\n${r.content}` : `cannot read ${f}: ${r.error}` }
}
