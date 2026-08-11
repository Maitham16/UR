export type RemoteReviewTriggerPosition = {
  word: string
  start: number
  end: number
}

const OPEN_TO_CLOSE: Record<string, string> = {
  '`': '`',
  '"': '"',
  '<': '>',
  '{': '}',
  '[': ']',
  '(': ')',
  "'": "'",
}

/**
 * Find `ultrareview` launch directives while ignoring quoted text, paths,
 * identifiers, feature questions, and slash-command arguments.
 */
export function findRemoteReviewTriggerPositions(
  text: string,
): RemoteReviewTriggerPosition[] {
  const keyword = 'ultrareview'
  if (!new RegExp(keyword, 'i').test(text) || text.startsWith('/')) return []

  const quotedRanges: Array<{ start: number; end: number }> = []
  let openQuote: string | null = null
  let openAt = 0
  const isWord = (ch: string | undefined) =>
    Boolean(ch && /[\p{L}\p{N}_]/u.test(ch))

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (openQuote) {
      if (openQuote === '[' && ch === '[') {
        openAt = i
        continue
      }
      if (ch !== OPEN_TO_CLOSE[openQuote]) continue
      if (openQuote === "'" && isWord(text[i + 1])) continue
      quotedRanges.push({ start: openAt, end: i + 1 })
      openQuote = null
    } else if (
      (ch === '<' && i + 1 < text.length && /[a-zA-Z/]/.test(text[i + 1]!)) ||
      (ch === "'" && !isWord(text[i - 1])) ||
      (ch !== '<' && ch !== "'" && ch in OPEN_TO_CLOSE)
    ) {
      openQuote = ch
      openAt = i
    }
  }

  const positions: RemoteReviewTriggerPosition[] = []
  for (const match of text.matchAll(/\bultrareview\b/gi)) {
    if (match.index === undefined) continue
    const start = match.index
    const end = start + match[0].length
    if (quotedRanges.some(range => start >= range.start && start < range.end)) {
      continue
    }
    const before = text[start - 1]
    const after = text[end]
    if (before === '/' || before === '\\' || before === '-') continue
    if (after === '/' || after === '\\' || after === '-' || after === '?') {
      continue
    }
    if (after === '.' && isWord(text[end + 1])) continue
    positions.push({ word: match[0], start, end })
  }
  return positions
}
