import type { LocalCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { searchFiles } from '../../ur/fileops.js'
export const call: LocalCommandCall = async (args: string) => {
  const q = (args ?? '').trim()
  if (!q) return { type: 'text', value: 'usage: /search <query>' }
  const hits = searchFiles(getCwd(), q)
  if (!hits.length) return { type: 'text', value: `no matches for "${q}"` }
  return { type: 'text', value: `${hits.length} match(es) for "${q}":\n` + hits.map((h) => `  ${h.file}:${h.line}  ${h.text}`).join('\n') }
}
