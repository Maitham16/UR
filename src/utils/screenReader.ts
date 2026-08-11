import type { Screen } from '../ink/screen.js'
import { CellWidth, charInCellAt } from '../ink/screen.js'
import { isEnvTruthy } from './envUtils.js'

const announcements: string[] = []

export function isScreenReaderMode(): boolean {
  return (
    isEnvTruthy(process.env.UR_SCREEN_READER) ||
    isEnvTruthy(process.env.UR_CODE_ACCESSIBILITY)
  )
}

export function enableScreenReaderMode(): void {
  process.env.UR_SCREEN_READER = '1'
  process.env.UR_CODE_ACCESSIBILITY = '1'
}

export function disableScreenReaderMode(): void {
  delete process.env.UR_SCREEN_READER
  delete process.env.UR_CODE_ACCESSIBILITY
}

function spokenCharacter(value: string): string {
  if (value === ' ') return 'space'
  if (value === '\n') return 'new line'
  if (value === '\t') return 'tab'
  return value
}

export function describeScreenReaderEdit(
  previous: string,
  next: string,
): string | undefined {
  if (previous === next) return undefined
  let prefix = 0
  while (
    prefix < previous.length &&
    prefix < next.length &&
    previous[prefix] === next[prefix]
  ) {
    prefix++
  }
  let suffix = 0
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++
  }
  const removed = previous.slice(prefix, previous.length - suffix)
  const inserted = next.slice(prefix, next.length - suffix)
  if (removed.length === 0) {
    return inserted.length === 1
      ? spokenCharacter(inserted)
      : `Inserted ${inserted.length} characters`
  }
  if (inserted.length === 0) {
    return removed.length === 1
      ? `Deleted ${spokenCharacter(removed)}`
      : `Deleted ${removed.length} characters`
  }
  return `Replaced ${removed.length} characters with ${inserted.length}`
}

export function announceScreenReaderEdit(previous: string, next: string): void {
  if (!isScreenReaderMode()) return
  const message = describeScreenReaderEdit(previous, next)
  if (message) announcements.push(message)
}

export function consumeScreenReaderAnnouncements(): string[] {
  return announcements.splice(0, announcements.length)
}

/** Convert the terminal buffer to stable, decoration-light plain text. */
export function screenToPlainText(screen: Screen): string {
  const lines: string[] = []
  for (let y = 0; y < screen.height; y++) {
    let line = ''
    for (let x = 0; x < screen.width; x++) {
      const packed = screen.cells[(y * screen.width + x) * 2 + 1]
      if ((packed & 0b11) !== CellWidth.SpacerTail) {
        line += charInCellAt(screen, x, y) ?? ' '
      }
    }
    const trimmed = line.trimEnd()
    if (/^[\s─━═╌╍┄┅┈┉-]+$/u.test(trimmed)) continue
    lines.push(trimmed)
  }
  while (lines.at(-1) === '') lines.pop()
  return lines.join('\n')
}

/** Return only the new semantic text that a screen reader should announce. */
export function diffScreenReaderText(previous: string, next: string): string {
  if (!next || previous === next) return ''
  if (!previous) return `${next}\n`
  const before = previous.split('\n')
  const after = next.split('\n')
  const output: string[] = []
  const length = Math.max(before.length, after.length)
  for (let index = 0; index < length; index++) {
    const oldLine = before[index] ?? ''
    const newLine = after[index] ?? ''
    if (!newLine || oldLine === newLine) continue
    if (oldLine && newLine.startsWith(oldLine)) {
      const appended = newLine.slice(oldLine.length).trim()
      if (appended) output.push(appended)
    } else {
      output.push(newLine)
    }
  }
  return output.length > 0 ? `${output.join('\n')}\n` : ''
}

export function resetScreenReaderForTest(): void {
  announcements.length = 0
}
