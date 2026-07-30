import { ASK_USER_QUESTION_TOOL_CHIP_WIDTH } from './prompt.js'

const MAX_RECOVERABLE_HEADER_CHARS = 500
const CONTROL_OR_ANSI_RE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]|\u001B\[/

const HEADER_STOP_WORDS = new Set([
  'a',
  'about',
  'also',
  'an',
  'are',
  'be',
  'do',
  'does',
  'for',
  'is',
  'or',
  'should',
  'support',
  'that',
  'the',
  'this',
  'to',
  'want',
  'what',
  'which',
  'with',
  'without',
  'you',
])

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function sliceWithoutSplittingSurrogate(value: string, max: number): string {
  let result = value.slice(0, max)
  if (
    result.length > 0 &&
    /[\uD800-\uDBFF]/.test(result[result.length - 1]!)
  ) {
    result = result.slice(0, -1)
  }
  return result
}

export function headerFromQuestion(question: string, index: number): string {
  const word =
    question
      .replace(/[^A-Za-z0-9]+/g, ' ')
      .split(/\s+/)
      .find(part => part && !HEADER_STOP_WORDS.has(part.toLowerCase())) ??
    `Question ${index + 1}`
  return sliceWithoutSplittingSurrogate(
    word,
    ASK_USER_QUESTION_TOOL_CHIP_WIDTH,
  )
}

/**
 * The header is a compact UI category chip, not decision content. Weak models
 * frequently exceed its 12-character display width by one short word (for
 * example, "Nova mechanic"). Recover that presentation-only field while
 * preserving every question, choice and trade-off exactly.
 *
 * Unsafe and grossly oversized values remain unchanged so the strict schema
 * rejects them instead of hiding malformed input.
 */
export function normalizeQuestionHeader(
  header: string,
  question: string,
  index: number,
): string {
  const trimmed = header.trim()
  if (
    trimmed.length <= ASK_USER_QUESTION_TOOL_CHIP_WIDTH ||
    trimmed.length > MAX_RECOVERABLE_HEADER_CHARS ||
    CONTROL_OR_ANSI_RE.test(trimmed)
  ) {
    return trimmed
  }

  const firstWord = trimmed.split(/\s+/)[0] ?? ''
  const compact = sliceWithoutSplittingSurrogate(
    firstWord,
    ASK_USER_QUESTION_TOOL_CHIP_WIDTH,
  )
  return compact || headerFromQuestion(question, index)
}

/**
 * Apply only the bounded header compatibility rule to a canonical Ask object.
 * This is used before lossless provider-recovery equality checks so no other
 * field can be silently repaired or truncated.
 */
export function normalizeAskQuestionHeaders(
  value: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(value.questions)) return value
  let changed = false
  const questions = value.questions.map((candidate, index) => {
    const question = objectValue(candidate)
    if (
      !question ||
      typeof question.header !== 'string' ||
      typeof question.question !== 'string'
    ) {
      return candidate
    }
    const header = normalizeQuestionHeader(
      question.header,
      question.question,
      index,
    )
    if (header === question.header) return candidate
    changed = true
    return { ...question, header }
  })
  return changed ? { ...value, questions } : value
}
