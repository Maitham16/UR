import type { LocalCommandCall } from '../../types/command.js'
import { getAutoMemPath, isAutoMemoryEnabled } from '../../memdir/paths.js'
import { getCwd } from '../../utils/cwd.js'
import { remember, listMemory, rememberInAutoMemory } from '../../ur/notes.js'

export const call: LocalCommandCall = async (args: string) => {
  const text = (args ?? '').trim()
  if (!text) {
    try {
      const notes = listMemory(getCwd())
      return { type: 'text', value: notes.length ? notes.map((n) => `- ${n.text}`).join('\n') : 'no memory notes yet' }
    } catch (error) {
      return {
        type: 'text',
        value: `failed to read memory notes: ${error instanceof Error ? error.message : String(error)}`,
        exitCode: 1,
      }
    }
  }
  try {
    remember(getCwd(), text)
  } catch (error) {
    return {
      type: 'text',
      value: `failed to remember note: ${error instanceof Error ? error.message : String(error)}`,
      exitCode: 1,
    }
  }
  if (isAutoMemoryEnabled() && !rememberInAutoMemory(getAutoMemPath(), text)) {
    return {
      type: 'text',
      value:
        `remembered in project notes, but failed to promote the note to auto-memory: ${text}`,
      exitCode: 1,
    }
  }
  return { type: 'text', value: `remembered: ${text}` }
}
