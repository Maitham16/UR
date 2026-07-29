import type { LocalCommandCall } from '../../types/command.js'
import { getAutoMemPath } from '../../memdir/paths.js'
import { getCwd } from '../../utils/cwd.js'
import {
  forget,
  forgetInAutoMemory,
  listMemory,
} from '../../ur/notes.js'
export const call: LocalCommandCall = async (args: string) => {
  const text = (args ?? '').trim()
  if (!text) return { type: 'text', value: 'usage: /forget <text>', exitCode: 2 }
  const cwd = getCwd()
  try {
    const matchingTexts = listMemory(cwd)
      .filter(note => note.text.toLowerCase().includes(text.toLowerCase()))
      .map(note => note.text)
    const n = forget(cwd, text)
    const promoted = forgetInAutoMemory(getAutoMemPath(), matchingTexts)
    return {
      type: 'text',
      value:
        n > 0
          ? `forgot ${n} note(s) matching "${text}"${promoted ? ` and removed ${promoted} promoted auto-memory topic(s)` : ''}`
          : `no notes matched "${text}"`,
    }
  } catch (error) {
    return {
      type: 'text',
      value: `failed to forget matching notes: ${error instanceof Error ? error.message : String(error)}`,
      exitCode: 1,
    }
  }
}
