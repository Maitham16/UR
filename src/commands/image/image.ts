import { existsSync, statSync } from 'node:fs'
import { extname, isAbsolute, resolve } from 'node:path'
import type { LocalCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { commandExists, runCapture } from '../../ur/sysinfo.js'

export const call: LocalCommandCall = async (args: string) => {
  const f = (args ?? '').trim().split(/\s+/)[0] ?? ''
  if (!f) return { type: 'text', value: 'usage: /image <file> [task]' }
  const abs = isAbsolute(f) ? f : resolve(getCwd(), f)
  if (!existsSync(abs)) return { type: 'text', value: `not found: ${f}` }
  const kb = Math.round(statSync(abs).size / 1024)
  const lines = [`image ${f} — ${extname(abs) || '?'}, ${kb} KB`]
  if (commandExists('tesseract')) {
    const r = runCapture('tesseract', [abs, 'stdout', '--psm', '3'], 20000)
    if (r.ok && r.out) lines.push('', 'OCR text:', r.out.length > 4000 ? r.out.slice(0, 4000) + '\n… [truncated]' : r.out)
    else lines.push('', 'OCR: no text detected.')
  } else {
    lines.push('', 'OCR needs tesseract (brew install tesseract). For visual description, paste with Ctrl+V or use a vision model.')
  }
  return { type: 'text', value: lines.join('\n') }
}
