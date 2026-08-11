/**
 * Make characters that can visually hide or reorder shell commands explicit.
 *
 * This is a presentation-only transform. Permission matching and execution
 * must always use the original command string.
 */
export function formatCommandForDisplay(command: string): string {
  let output = ''

  for (const character of command) {
    const codePoint = character.codePointAt(0)!

    if (character === '\n') {
      output += character
      continue
    }
    if (character === '\t') {
      output += '\\t'
      continue
    }
    if (character === '\r') {
      output += '\\r'
      continue
    }
    if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      output += `\\x${codePoint.toString(16).padStart(2, '0').toUpperCase()}`
      continue
    }
    if (isInvisibleOrDirectionControl(codePoint)) {
      output += `\\u{${codePoint.toString(16).toUpperCase()}}`
      continue
    }

    output += character
  }

  return output
}

function isInvisibleOrDirectionControl(codePoint: number): boolean {
  return (
    codePoint === 0x00ad || // soft hyphen
    codePoint === 0x034f || // combining grapheme joiner
    codePoint === 0x061c || // Arabic letter mark
    codePoint === 0x115f ||
    codePoint === 0x1160 ||
    codePoint === 0x1680 ||
    codePoint === 0x180e ||
    (codePoint >= 0x2000 && codePoint <= 0x200f) ||
    (codePoint >= 0x2028 && codePoint <= 0x202f) ||
    (codePoint >= 0x205f && codePoint <= 0x206f) ||
    codePoint === 0x3000 ||
    codePoint === 0x3164 ||
    codePoint === 0xfeff ||
    codePoint === 0xffa0
  )
}
