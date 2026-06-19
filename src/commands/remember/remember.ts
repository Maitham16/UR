import type { LocalCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { remember, listMemory } from '../../ur/notes.js'
export const call: LocalCommandCall = async (args: string) => {
  const text = (args ?? '').trim()
  if (!text) {
    const notes = listMemory(getCwd())
    return { type: 'text', value: notes.length ? notes.map((n) => `- ${n.text}`).join('\n') : 'no memory notes yet' }
  }
  remember(getCwd(), text)
  return { type: 'text', value: `remembered: ${text}` }
}
