import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getAutoMemPath, isAutoMemoryEnabled } from '../../memdir/paths.js'
import { listMemory } from '../../ur/notes.js'
import { getCwd } from '../../utils/cwd.js'

/**
 * Everything already remembered, so a candidate the user has recorded is never
 * offered back to them. Covers the three places memory lives: the notes store
 * `/remember` writes to, the project UR.md files, and the auto-memory dir.
 *
 * Each source is best-effort — a missing or unreadable one narrows the dedup
 * rather than failing the caller.
 */
export function existingMemoryLines(cwd: string = getCwd()): string[] {
  const lines: string[] = []
  try {
    lines.push(...listMemory(cwd).map(note => note.text))
  } catch {
    /* notes store unreadable; fall through to the file sources */
  }
  const files = [join(cwd, 'UR.md'), join(cwd, 'UR.local.md')]
  if (isAutoMemoryEnabled()) {
    try {
      files.push(join(getAutoMemPath(), 'MEMORY.md'))
    } catch {
      /* auto-memory path unresolved */
    }
  }
  for (const file of files) {
    try {
      if (!existsSync(file)) continue
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        // Bullets and prose lines both count; headings and fences do not.
        const trimmed = line.replace(/^\s*[-*+]\s+/, '').trim()
        if (trimmed.length >= 12 && !/^[#`]/.test(trimmed)) lines.push(trimmed)
      }
    } catch {
      /* unreadable file narrows dedup rather than failing */
    }
  }
  return lines
}
