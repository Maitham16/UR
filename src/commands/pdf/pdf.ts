import { existsSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type { LocalCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { commandExists, runCapture } from '../../ur/sysinfo.js'

const MAX_TEXT = 12_000

/**
 * Deps-aware PDF ingestion (mirrors /image): pdftotext (poppler) extracts
 * text, pdfinfo adds metadata; both degrade gracefully with install hints.
 * Pages accepts "3" or "2-7" to bound extraction on large documents.
 */
export const call: LocalCommandCall = async (args: string) => {
  const parts = (args ?? '').trim().split(/\s+/).filter(Boolean)
  const f = parts[0] ?? ''
  if (!f) return { type: 'text', value: 'usage: /pdf <file> [pages] [task] — pages like 3 or 2-7' }
  const abs = isAbsolute(f) ? f : resolve(getCwd(), f)
  if (!existsSync(abs)) return { type: 'text', value: `not found: ${f}` }
  const kb = Math.round(statSync(abs).size / 1024)
  const lines = [`pdf ${f} — ${kb} KB`]

  if (commandExists('pdfinfo')) {
    const info = runCapture('pdfinfo', [abs], 15000)
    if (info.ok && info.out) {
      const keep = info.out
        .split('\n')
        .filter(l => /^(Title|Author|Pages|Creation|Producer):/i.test(l))
      if (keep.length) lines.push('', ...keep)
    }
  }

  if (commandExists('pdftotext')) {
    const pageRange = /^(\d+)(?:-(\d+))?$/.exec(parts[1] ?? '')
    const pageArgs = pageRange
      ? ['-f', pageRange[1]!, '-l', pageRange[2] ?? pageRange[1]!]
      : []
    const r = runCapture('pdftotext', ['-layout', ...pageArgs, abs, '-'], 30000)
    if (r.ok && r.out.trim()) {
      lines.push(
        '',
        pageRange ? `Text (pages ${pageRange[0]}):` : 'Text:',
        r.out.length > MAX_TEXT ? `${r.out.slice(0, MAX_TEXT)}\n… [truncated — pass a page range like /pdf ${f} 2-5]` : r.out,
      )
    } else {
      lines.push('', 'No extractable text (scanned PDF?). OCR route: install tesseract and convert pages with pdftoppm, or use /image on a page screenshot.')
    }
  } else {
    lines.push('', 'Text extraction needs pdftotext (brew install poppler / apt install poppler-utils).')
  }

  return { type: 'text', value: lines.join('\n') }
}
