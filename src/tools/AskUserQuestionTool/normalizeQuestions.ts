/**
 * Repair pass for AskUserQuestion payloads, applied before validation.
 *
 * The schema carries a uniqueness refinement that rejects duplicate question
 * texts and duplicate option labels. Rejection is the wrong response to a
 * duplicate: the call fails, the model is told its arguments were invalid, and
 * it retries — so a recoverable formatting slip costs a whole extra round trip
 * and shows the user nothing. A duplicate label carries no information the
 * first occurrence does not, so it is dropped here and validation sees a clean
 * payload.
 *
 * Only genuinely unrecoverable input is left for the schema to reject: a
 * question with fewer than two distinct options is not askable, and no repair
 * can invent one.
 */

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Comparison key for duplicate detection. Case- and whitespace-insensitive so
 * "PostgreSQL" and "postgresql " collapse, which is what a user reading the
 * list would consider the same choice.
 */
export function duplicateKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Drop repeated option labels within one question, keeping the first
 * occurrence (which carries the description the model wrote first).
 */
export function dedupeOptions(options: unknown[]): unknown[] {
  const seen = new Set<string>()
  const out: unknown[] = []
  for (const option of options) {
    const label = isRecord(option) && typeof option.label === 'string' ? option.label : null
    if (label === null) {
      // Not yet in object form, or malformed — leave it for the schema.
      out.push(option)
      continue
    }
    const key = duplicateKey(label)
    if (!key || seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push(option)
  }
  return out
}

/**
 * Drop repeated questions, keeping the first. A second copy of the same
 * question would render as two identical tabs the user must answer twice.
 */
export function dedupeQuestions(questions: unknown[]): unknown[] {
  const seen = new Set<string>()
  const out: unknown[] = []
  for (const question of questions) {
    if (!isRecord(question) || typeof question.question !== 'string') {
      out.push(question)
      continue
    }
    const key = duplicateKey(question.question)
    if (!key || seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push({
      ...question,
      ...(Array.isArray(question.options) ? { options: dedupeOptions(question.options) } : {}),
    })
  }
  return out
}

/**
 * Reasons a payload cannot be rendered, computed before anything is sent or
 * drawn. Returns an empty array when the payload is renderable.
 *
 * This exists so a malformed payload produces one clear, specific message
 * instead of a generic schema error the model has to guess at.
 */
export function describeQuestionPayloadProblems(value: unknown): string[] {
  const problems: string[] = []
  if (!isRecord(value)) {
    return ['Input must be an object with a `questions` array.']
  }
  const questions = value.questions
  if (!Array.isArray(questions) || questions.length === 0) {
    return ['`questions` must be a non-empty array.']
  }
  questions.forEach((question, index) => {
    const where = `questions[${index}]`
    if (!isRecord(question)) {
      problems.push(`${where} must be an object.`)
      return
    }
    if (typeof question.question !== 'string' || !question.question.trim()) {
      problems.push(`${where}.question must be a non-empty string.`)
    }
    if (typeof question.header !== 'string' || !question.header.trim()) {
      problems.push(`${where}.header must be a non-empty string.`)
    }
    if (!Array.isArray(question.options)) {
      problems.push(`${where}.options must be an array.`)
      return
    }
    const distinct = new Set(
      question.options
        .filter(isRecord)
        .map(option => (typeof option.label === 'string' ? duplicateKey(option.label) : ''))
        .filter(Boolean),
    )
    if (distinct.size < 2) {
      problems.push(
        `${where}.options must contain at least 2 distinct labels; this question is open-ended and should be asked in plain text instead.`,
      )
    }
  })
  return problems
}
