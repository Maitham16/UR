export type ExplicitChoiceRecoverySource =
  | 'thinking_json'
  | 'markdown_menu'

export interface ExplicitChoiceCandidate {
  input: Record<string, unknown>
  source: ExplicitChoiceRecoverySource
  remainingText: string
}

const MAX_REASONING_CHARS = 64 * 1024
const MAX_MENU_CHARS = 4 * 1024
const MAX_QUESTION_CHARS = 500
const MAX_LABEL_CHARS = 80
const MAX_DESCRIPTION_CHARS = 500
const MAX_OPTIONS = 8
const MAX_QUESTIONS = 4

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional])
  const keys = Object.keys(value)
  return (
    required.every(key => Object.prototype.hasOwnProperty.call(value, key)) &&
    keys.every(key => allowed.has(key))
  )
}

/**
 * This is deliberately only a structural filter. The live AskUserQuestion
 * Zod schema remains the final authority before a recovered call can execute.
 * Keeping the object unchanged here makes reasoning-block recovery lossless.
 */
function hasCanonicalAskShape(value: unknown): value is Record<string, unknown> {
  const input = objectValue(value)
  if (
    !input ||
    !hasOnlyKeys(input, ['questions'], ['metadata']) ||
    !Array.isArray(input.questions) ||
    input.questions.length < 1 ||
    input.questions.length > MAX_QUESTIONS
  ) {
    return false
  }

  if (input.metadata !== undefined && !objectValue(input.metadata)) {
    return false
  }

  return input.questions.every(questionValue => {
    const question = objectValue(questionValue)
    if (
      !question ||
      !hasOnlyKeys(
        question,
        ['question', 'header', 'options'],
        ['multiSelect'],
      ) ||
      typeof question.question !== 'string' ||
      typeof question.header !== 'string' ||
      !Array.isArray(question.options) ||
      question.options.length < 2 ||
      question.options.length > MAX_OPTIONS ||
      (question.multiSelect !== undefined &&
        typeof question.multiSelect !== 'boolean')
    ) {
      return false
    }

    return question.options.every(optionValue => {
      const option = objectValue(optionValue)
      return Boolean(
        option &&
          hasOnlyKeys(option, ['label'], ['description', 'preview']) &&
          typeof option.label === 'string' &&
          (option.description === undefined ||
            typeof option.description === 'string') &&
          (option.preview === undefined || typeof option.preview === 'string'),
      )
    })
  })
}

function findJsonObjectEnd(text: string, start: number): number | null {
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < text.length; index++) {
    const character = text[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }

    if (character === '"') {
      inString = true
    } else if (character === '{') {
      depth++
    } else if (character === '}') {
      depth--
      if (depth === 0) return index + 1
      if (depth < 0) return null
    }
  }

  return null
}

function hasExplicitAskToolIntent(prefix: string): boolean {
  const nearby = prefix.slice(-1_000)
  if (
    /\b(?:for example|example|sample|illustration|schema)\b/i.test(
      nearby.slice(-240),
    )
  ) {
    return false
  }

  return (
    /\b(?:use|using|call|calling|invoke|invoking|emit|emitting)\b[\s\S]{0,100}\bAskUserQuestion\b/i.test(
      nearby,
    ) ||
    /\bAskUserQuestion\b[\s\S]{0,100}\b(?:tool|call|invoke)\b/i.test(
      nearby,
    )
  )
}

function parseFinalReasoningAskJson(
  reasoning: string,
): Record<string, unknown> | null {
  if (
    reasoning.length === 0 ||
    reasoning.length > MAX_REASONING_CHARS
  ) {
    return null
  }

  const trimmed = reasoning.trimEnd()
  if (!trimmed.endsWith('}')) return null

  const candidates: Array<{
    start: number
    input: Record<string, unknown>
  }> = []

  for (
    let start = trimmed.indexOf('{');
    start !== -1;
    start = trimmed.indexOf('{', start + 1)
  ) {
    const end = findJsonObjectEnd(trimmed, start)
    if (end !== trimmed.length) continue

    try {
      const parsed: unknown = JSON.parse(trimmed.slice(start))
      if (hasCanonicalAskShape(parsed)) {
        candidates.push({ start, input: parsed })
      }
    } catch {
      // Reasoning recovery never repairs JSON. A malformed object is not a
      // lossless tool call and must stay as reasoning.
    }
  }

  if (candidates.length !== 1) return null
  const candidate = candidates[0]!
  const prefix = trimmed.slice(0, candidate.start)
  if (prefix.includes('```') || !hasExplicitAskToolIntent(prefix)) return null
  return candidate.input
}

function headerFromQuestion(question: string): string {
  const stopWords = new Set([
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
    'we',
    'what',
    'which',
    'with',
    'without',
    'you',
  ])
  const word = question
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .split(/\s+/)
    .find(part => part && !stopWords.has(part.toLowerCase()))
  const header = word ?? 'Choice'
  return (
    header.slice(0, 1).toLocaleUpperCase() + header.slice(1)
  ).slice(0, 12)
}

/**
 * Convert only a complete, standalone Markdown decision menu. Every
 * user-visible question, label, and description is copied verbatim; only the
 * required short UI header is derived deterministically.
 */
export function parseExplicitChoicePrompt(
  text: string,
): ExplicitChoiceCandidate | null {
  if (!text || text.length > MAX_MENU_CHARS || /```|[{}]/.test(text)) {
    return null
  }

  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  const questionIndexes = lines.flatMap((line, index) =>
    /^\*\*[^*\n]+\?\*\*$/.test(line) ? [index] : [],
  )
  if (questionIndexes.length !== 1) return null

  const questionIndex = questionIndexes[0]!
  const preamble = lines.slice(0, questionIndex)
  if (
    preamble.length > 2 ||
    preamble.some(
      line =>
        line.length > 500 ||
        line.includes('?') ||
        /^[-*+#>]/.test(line),
    )
  ) {
    return null
  }

  const questionMatch = lines[questionIndex]!.match(
    /^\*\*([^*\n]+\?)\*\*$/,
  )
  const question = questionMatch?.[1]
  if (!question || question.length > MAX_QUESTION_CHARS) return null

  const options: Array<{ label: string; description: string }> = []
  let lineIndex = questionIndex + 1
  while (lineIndex < lines.length) {
    const match = lines[lineIndex]!.match(
      /^-\s+\*\*([^*\n]+)\*\*\s+[–—]\s+(.+)$/,
    )
    if (!match) break

    const label = match[1]!
    const description = match[2]!
    const normalizedLabel = label.toLocaleLowerCase()
    if (
      label.length > MAX_LABEL_CHARS ||
      description.length > MAX_DESCRIPTION_CHARS ||
      normalizedLabel === 'other' ||
      normalizedLabel === '__other__'
    ) {
      return null
    }
    options.push({ label, description })
    lineIndex++
  }

  if (options.length < 2 || options.length > MAX_OPTIONS) return null
  if (
    new Set(options.map(option => option.label.toLocaleLowerCase())).size !==
    options.length
  ) {
    return null
  }

  const trailing = lines.slice(lineIndex)
  if (
    trailing.length !== 1 ||
    trailing[0]!.includes('?') ||
    !/^(?:please\s+)?(?:select|choose|pick)\b.{0,120}\b(?:option|choice)\b/i.test(
      trailing[0]!,
    )
  ) {
    return null
  }

  return {
    input: {
      questions: [
        {
          question,
          header: headerFromQuestion(question),
          options,
        },
      ],
    },
    source: 'markdown_menu',
    remainingText: preamble.join('\n'),
  }
}

export function collectExplicitChoiceCandidates({
  thinkingBlocks,
  textBlocks,
}: {
  thinkingBlocks: string[]
  textBlocks: string[]
}): ExplicitChoiceCandidate[] {
  const candidates: ExplicitChoiceCandidate[] = []
  const reasoningCandidates = thinkingBlocks
    .map(parseFinalReasoningAskJson)
    .filter(
      (input): input is Record<string, unknown> => input !== null,
    )

  // Multiple valid reasoning objects can represent different decisions. Do
  // not guess which one the model intended to invoke.
  if (reasoningCandidates.length === 1) {
    candidates.push({
      input: reasoningCandidates[0]!,
      source: 'thinking_json',
      remainingText: '',
    })
  }

  const menuCandidates = textBlocks
    .map(parseExplicitChoicePrompt)
    .filter(
      (candidate): candidate is ExplicitChoiceCandidate =>
        candidate !== null,
    )
  if (menuCandidates.length === 1) {
    candidates.push(menuCandidates[0]!)
  }

  return candidates
}
