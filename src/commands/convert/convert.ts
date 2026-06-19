import type { LocalCommandCall } from '../../types/command.js'
import { commandExists } from '../../ur/sysinfo.js'
export const call: LocalCommandCall = async (args: string) => {
  const parts = (args ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return { type: 'text', value: 'usage: /convert <file> <target-format>' }
  const tools = [['pandoc', 'documents'], ['ffmpeg', 'audio/video'], ['libreoffice', 'office docs']] as const
  const have = tools.filter(([t]) => commandExists(t)).map(([t, k]) => `${t} (${k})`)
  return {
    type: 'text',
    value: `Conversion ${parts[0]} → ${parts[1]}.\nAvailable converters: ${have.join(', ') || 'none'}.\nAsk UR to run the conversion with an available tool, or install one (e.g. brew install pandoc ffmpeg).`,
  }
}
