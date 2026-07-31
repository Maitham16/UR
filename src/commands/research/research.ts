import type { LocalCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { addResearch, listResearch } from '../../ur/notes.js'
export const call: LocalCommandCall = async (args: string) => {
  const text = (args ?? '').trim()
  if (!text) {
    const items = listResearch(getCwd(), 'notes')
    return { type: 'text', value: items.length ? items.map((i) => `- ${i.text}`).join('\n') : 'no notes recorded yet' }
  }
  addResearch(getCwd(), 'notes', text)
  return { type: 'text', value: `added to notes: ${text}` }
}
