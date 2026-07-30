import type { ZodError } from 'zod/v4'
import { AbortError, ShellError } from './errors.js'
import { INTERRUPT_MESSAGE_FOR_TOOL_USE } from './messages.js'

export function formatError(error: unknown): string {
  if (error instanceof AbortError) {
    return error.message || INTERRUPT_MESSAGE_FOR_TOOL_USE
  }
  if (!(error instanceof Error)) {
    return String(error)
  }
  const parts = getErrorParts(error)
  const fullMessage =
    parts.filter(Boolean).join('\n').trim() || 'Command failed with no output'
  if (fullMessage.length <= 10000) {
    return fullMessage
  }
  const halfLength = 5000
  const start = fullMessage.slice(0, halfLength)
  const end = fullMessage.slice(-halfLength)
  return `${start}\n\n... [${fullMessage.length - 10000} characters truncated] ...\n\n${end}`
}

export function getErrorParts(error: Error): string[] {
  if (error instanceof ShellError) {
    return [
      `Exit code ${error.code}`,
      error.interrupted ? INTERRUPT_MESSAGE_FOR_TOOL_USE : '',
      error.stderr,
      error.stdout,
    ]
  }
  const parts = [error.message]
  if ('stderr' in error && typeof error.stderr === 'string') {
    parts.push(error.stderr)
  }
  if ('stdout' in error && typeof error.stdout === 'string') {
    parts.push(error.stdout)
  }
  return parts
}

/**
 * Formats a Zod validation path into a readable string
 * e.g., ['todos', 0, 'activeForm'] => 'todos[0].activeForm'
 */
function formatValidationPath(path: PropertyKey[]): string {
  if (path.length === 0) return ''

  return path.reduce((acc, segment, index) => {
    const segmentStr = String(segment)
    if (typeof segment === 'number') {
      return `${String(acc)}[${segmentStr}]`
    }
    return index === 0 ? segmentStr : `${String(acc)}.${segmentStr}`
  }, '') as string
}

function formatList(values: string[]): string {
  const quoted = values.map(value => `\`${value}\``)
  if (quoted.length <= 1) return quoted[0] ?? ''
  if (quoted.length === 2) return `${quoted[0]} and ${quoted[1]}`
  return `${quoted.slice(0, -1).join(', ')}, and ${quoted.at(-1)}`
}

function formatIndexSet(indexes: number[]): string {
  const sorted = [...new Set(indexes)].sort((a, b) => a - b)
  if (sorted.length === 0) return ''
  const contiguous = sorted.every(
    (value, index) => index === 0 || value === sorted[index - 1]! + 1,
  )
  if (contiguous && sorted.length > 1) {
    return `${sorted[0]}..${sorted.at(-1)}`
  }
  return sorted.join(',')
}

/**
 * Collapse repeated indexed omissions so one malformed array does not produce
 * dozens of near-identical lines that hide the actionable constraint.
 */
function formatMissingParameterErrors(error: ZodError): string[] {
  const missing = error.issues
    .map((issue, order) => ({ issue, order }))
    .filter(
      ({ issue }) =>
        issue.code === 'invalid_type' &&
        issue.message.includes('received undefined'),
    )

  type IndexedGroup = {
    prefix: PropertyKey[]
    suffix: PropertyKey[]
    indexes: number[]
    issueOrders: number[]
    firstOrder: number
  }

  const byPathShape = new Map<string, IndexedGroup>()
  for (const { issue, order } of missing) {
    const numericAt = issue.path.findIndex(segment => typeof segment === 'number')
    if (numericAt === -1 || numericAt === issue.path.length - 1) continue
    const prefix = issue.path.slice(0, numericAt)
    const suffix = issue.path.slice(numericAt + 1)
    const index = issue.path[numericAt]
    if (typeof index !== 'number') continue
    const key = JSON.stringify([prefix, suffix])
    const group = byPathShape.get(key) ?? {
      prefix,
      suffix,
      indexes: [],
      issueOrders: [],
      firstOrder: order,
    }
    group.indexes.push(index)
    group.issueOrders.push(order)
    byPathShape.set(key, group)
  }

  const combined = new Map<
    string,
    {
      prefix: PropertyKey[]
      indexes: number[]
      fields: string[]
      issueOrders: number[]
      firstOrder: number
    }
  >()
  for (const group of byPathShape.values()) {
    const indexes = [...new Set(group.indexes)].sort((a, b) => a - b)
    if (indexes.length < 2) continue
    const key = JSON.stringify([group.prefix, indexes])
    const entry = combined.get(key) ?? {
      prefix: group.prefix,
      indexes,
      fields: [],
      issueOrders: [],
      firstOrder: group.firstOrder,
    }
    entry.fields.push(formatValidationPath(group.suffix))
    entry.issueOrders.push(...group.issueOrders)
    entry.firstOrder = Math.min(entry.firstOrder, group.firstOrder)
    combined.set(key, entry)
  }

  const lines: Array<{ order: number; text: string }> = []
  const consumed = new Set<number>()
  for (const entry of combined.values()) {
    const base = `${formatValidationPath(entry.prefix)}[${formatIndexSet(entry.indexes)}]`
    const fields = [...new Set(entry.fields)]
    lines.push({
      order: entry.firstOrder,
      text:
        fields.length === 1
          ? `The required field ${formatList(fields)} is missing from \`${base}\``
          : `The required fields ${formatList(fields)} are missing from \`${base}\``,
    })
    for (const order of entry.issueOrders) consumed.add(order)
  }

  for (const { issue, order } of missing) {
    if (consumed.has(order)) continue
    lines.push({
      order,
      text: `The required parameter \`${formatValidationPath(issue.path)}\` is missing`,
    })
  }

  return lines.sort((a, b) => a.order - b.order).map(line => line.text)
}

function formatSizeConstraintErrors(error: ZodError): string[] {
  const result: string[] = []
  for (const issue of error.issues) {
    if (issue.code !== 'too_big' && issue.code !== 'too_small') continue
    const detail = issue as typeof issue & {
      origin?: string
      inclusive?: boolean
      maximum?: number | bigint
      minimum?: number | bigint
    }
    const limit =
      issue.code === 'too_big' ? detail.maximum : detail.minimum
    if (limit === undefined) {
      result.push(issue.message)
      continue
    }
    const path = formatValidationPath(issue.path) || 'input'
    const inclusive = detail.inclusive !== false
    const comparison =
      issue.code === 'too_big'
        ? inclusive
          ? 'at most'
          : 'fewer than'
        : inclusive
          ? 'at least'
          : 'more than'
    const unit =
      detail.origin === 'array'
        ? 'items'
        : detail.origin === 'string'
          ? 'characters'
          : null
    result.push(
      unit
        ? `The parameter \`${path}\` must contain ${comparison} ${String(limit)} ${unit}`
        : `The parameter \`${path}\` must be ${comparison} ${String(limit)}`,
    )
  }
  return [...new Set(result)]
}

function getAskUserQuestionCorrection(error: ZodError): string | null {
  if (!error.issues.some(issue => issue.path[0] === 'questions')) return null
  const inferredCount = error.issues.reduce((count, issue) => {
    const index = issue.path[0] === 'questions' ? issue.path[1] : undefined
    return typeof index === 'number' ? Math.max(count, index + 1) : count
  }, 0)
  const countNotice =
    inferredCount > 4
      ? ` This call contains at least ${inferredCount} incomplete question entries.`
      : ''
  return (
    'AskUserQuestion requires 1-4 complete question objects. Each object must ' +
    'contain `question`, `header`, and an `options` array with 2-8 ' +
    'objects containing `label`; include `description` only when it adds a ' +
    'useful consequence or trade-off.' +
    countNotice +
    ' Do not invent missing choices or truncate question/option content. ' +
    'Overlong UI headers are compacted automatically. Retry with at most four ' +
    'complete questions, ask remaining decisions in later rounds, and do not ' +
    'repeat the unchanged call.'
  )
}

function getWriteCorrection(error: ZodError): string | null {
  const missingRequiredField = error.issues.some(
    issue =>
      issue.code === 'invalid_type' &&
      issue.message.includes('received undefined') &&
      (issue.path[0] === 'file_path' || issue.path[0] === 'content'),
  )
  if (!missingRequiredField) return null
  return (
    'No file was written. Write requires both `file_path` and `content` in ' +
    'the same structured tool call. Assistant prose outside the call is not ' +
    'file content and will not be copied into it. Retry only after supplying ' +
    'the complete intended file text in `content`; do not repeat the ' +
    'unchanged call or claim the file was created until Write returns success.'
  )
}

/**
 * Converts Zod validation errors into a human-readable and LLM friendly error message
 *
 * @param toolName The name of the tool that failed validation
 * @param error The Zod error object
 * @returns A formatted error message string
 */
export function formatZodValidationError(
  toolName: string,
  error: ZodError,
): string {
  const missingParamErrors = formatMissingParameterErrors(error)
  const sizeConstraintErrors = formatSizeConstraintErrors(error)
  const unexpectedParams = [
    ...new Set(
      error.issues
        .filter(err => err.code === 'unrecognized_keys')
        .flatMap(err => err.keys),
    ),
  ]

  const typeMismatchParams = error.issues
    .filter(
      err =>
        err.code === 'invalid_type' &&
        !err.message.includes('received undefined'),
    )
    .map(err => {
      const typeErr = err as { expected: string }
      const receivedMatch = err.message.match(/received (\w+)/)
      const received = receivedMatch ? receivedMatch[1] : 'unknown'
      return {
        param: formatValidationPath(err.path),
        expected: typeErr.expected,
        received,
      }
    })

  // Default to original error message if we can't create a better one
  let errorContent = error.message

  // Build a human-readable error message
  const errorParts = []

  errorParts.push(...sizeConstraintErrors)
  errorParts.push(...missingParamErrors)

  if (unexpectedParams.length > 0) {
    const unexpectedParamErrors = unexpectedParams.map(
      param => `An unexpected parameter \`${param}\` was provided`,
    )
    errorParts.push(...unexpectedParamErrors)
  }

  if (typeMismatchParams.length > 0) {
    const typeErrors = typeMismatchParams.map(
      ({ param, expected, received }) =>
        `The parameter \`${param}\` type is expected as \`${expected}\` but provided as \`${received}\``,
    )
    errorParts.push(...typeErrors)
  }

  if (errorParts.length > 0) {
    errorContent = `${toolName} failed due to the following ${errorParts.length > 1 ? 'issues' : 'issue'}:\n${errorParts.join('\n')}`
  }

  if (toolName === 'AskUserQuestion') {
    const correction = getAskUserQuestionCorrection(error)
    if (correction) errorContent += `\n\n${correction}`
  } else if (toolName === 'Write') {
    const correction = getWriteCorrection(error)
    if (correction) errorContent += `\n\n${correction}`
  }

  return errorContent
}
