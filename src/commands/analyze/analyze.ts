import type { LocalCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { readFileSafe } from '../../ur/fileops.js'
export const call: LocalCommandCall = async (args: string) => {
  const f = (args ?? '').trim()
  if (!f) return { type: 'text', value: 'usage: /analyze <file>' }
  const r = readFileSafe(getCwd(), f)
  if (!r.ok) return { type: 'text', value: `cannot read ${f}: ${r.error}` }
  return { type: 'text', value: `Analyze this file (${f}):\n\n${r.content}` }
}
