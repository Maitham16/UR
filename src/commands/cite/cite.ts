import type { LocalCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { addResearch, listResearch } from '../../ur/notes.js'
export const call: LocalCommandCall = async (args: string) => {
  const text = (args ?? '').trim()
  try {
    if (!text) {
      const items = listResearch(getCwd(), 'citations')
      return { type: 'text', value: items.length ? items.map((i) => `- ${i.text}`).join('\n') : 'no citations recorded yet' }
    }
    addResearch(getCwd(), 'citations', text)
    return { type: 'text', value: `added to citations: ${text}` }
  } catch (error) {
    return {
      type: 'text',
      value: `failed to access citations: ${error instanceof Error ? error.message : String(error)}`,
      exitCode: 1,
    }
  }
}
