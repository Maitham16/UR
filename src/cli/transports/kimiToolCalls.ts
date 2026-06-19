export interface ParsedToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface KimiParseResult {
  text: string
  toolCalls: ParsedToolCall[]
}

type ToolNameCollection = ReadonlySet<string> | string[]

export interface TextToolCallParseOptions {
  availableToolNames?: ToolNameCollection
  parseBareJsonToolCalls?: boolean
}

const SECTION_RE = /<\|tool_calls_section_begin\|>([\s\S]*?)<\|tool_calls_section_end\|>/g
const CALL_RE = /<\|tool_call_begin\|>([\s\S]*?)<\|tool_call_argument_begin\|>([\s\S]*?)<\|tool_call_end\|>/g
const STRAY_RE = /<\|tool_calls?_section_(?:begin|end)\|>|<\|tool_call_(?:begin|end|argument_begin)\|>/g

function parseArgs(raw: string): Record<string, unknown> {
  const s = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    const v = JSON.parse(s)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    try {
      return JSON.parse(s.replace(/,\s*([}\]])/g, '$1')) as Record<string, unknown>
    } catch {
      return {}
    }
  }
}

export function parseKimiToolCalls(text: string): KimiParseResult {
  if (!text || !text.includes('<|tool_call')) return { text, toolCalls: [] }
  const toolCalls: ParsedToolCall[] = []
  let i = 0
  CALL_RE.lastIndex = 0
  let cleaned = text.replace(CALL_RE, (_full, rawName: string, rawArgs: string) => {
    const name = (rawName ?? '').trim().replace(/^functions\./, '').replace(/[:.]\d+\s*$/, '').trim()
    if (name) toolCalls.push({ id: `kimi_${Date.now().toString(36)}_${i++}`, name, input: parseArgs(rawArgs ?? '') })
    return ''
  })
  cleaned = cleaned.replace(SECTION_RE, '').replace(STRAY_RE, '').replace(/\n{3,}/g, '\n\n').trim()
  return { text: cleaned, toolCalls }
}

function hasTool(
  availableToolNames: ToolNameCollection | undefined,
  name: string,
): boolean {
  if (!availableToolNames) return false
  return Array.isArray(availableToolNames)
    ? availableToolNames.includes(name)
    : availableToolNames.has(name)
}

function sameKeys(
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

function parseJsonishString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string
  } catch {
    return raw
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
  }
}

function parseLooseWriteObject(trimmed: string): Record<string, unknown> | null {
  const match = trimmed.match(
    /^\{\s*"file_path"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"content"\s*:\s*"([\s\S]*)"\s*\}$/,
  )
  if (!match) return null
  return {
    file_path: parseJsonishString(match[1] ?? ''),
    content: parseJsonishString(match[2] ?? ''),
  }
}

function parseLooseEditObject(trimmed: string): Record<string, unknown> | null {
  const match = trimmed.match(
    /^\{\s*(?:"replace_all"\s*:\s*(true|false)\s*,\s*)?"file_path"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"old_string"\s*:\s*"([\s\S]*?)"\s*,\s*"new_string"\s*:\s*"([\s\S]*)"\s*(?:,\s*"replace_all"\s*:\s*(true|false))?\s*\}$/,
  )
  if (!match) return null
  return {
    file_path: parseJsonishString(match[2] ?? ''),
    old_string: parseJsonishString(match[3] ?? ''),
    new_string: parseJsonishString(match[4] ?? ''),
    ...(match[1] !== undefined || match[5] !== undefined
      ? { replace_all: (match[1] ?? match[5]) === 'true' }
      : {}),
  }
}

function stripCodeFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json|JSON)?\s*\n?/, '')
    .replace(/\n?```$/, '')
    .trim()
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = stripCodeFences(text)
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null
  try {
    const value = JSON.parse(trimmed)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    const end = findJsonObjectEnd(trimmed, 0)
    if (end !== null && trimmed.slice(end).trim()) return null
    return parseLooseWriteObject(trimmed) ?? parseLooseEditObject(trimmed)
  }
}

function findJsonObjectEnd(text: string, start: number): number | null {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
    } else if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return null
}

function nextBareJsonObjectStart(text: string, from: number): number {
  let index = text.indexOf('{', from)
  while (index !== -1) {
    if (looksLikeBareJsonToolCallPrefix(text.slice(index))) return index
    index = text.indexOf('{', index + 1)
  }
  return -1
}

function removableLineRange(
  text: string,
  start: number,
  end: number,
): { prefixEnd: number; end: number } | null {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  if (!/^[ \t]*$/.test(text.slice(lineStart, start))) return null
  const after = text.slice(end).match(/^[ \t]*(?:\r?\n)?/)
  if (!after) return null
  if (!after[0].includes('\n') && end + after[0].length !== text.length) return null
  return { prefixEnd: lineStart, end: end + after[0].length }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function headerFromQuestion(question: string, index: number): string {
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
    'what',
    'which',
    'with',
    'without',
    'you',
  ])
  const word =
    question
      .replace(/[^A-Za-z0-9]+/g, ' ')
      .split(/\s+/)
      .find(part => part && !stopWords.has(part.toLowerCase())) ??
    `Question ${index + 1}`
  return word.slice(0, 12)
}

function normalizeQuestionOption(value: unknown): Record<string, unknown> | null {
  const option = objectValue(value)
  if (!option) return null
  const label =
    typeof option.label === 'string' && option.label.trim()
      ? option.label.trim()
      : typeof option.value === 'string' && option.value.trim()
        ? option.value.trim()
        : ''
  const description =
    typeof option.description === 'string' && option.description.trim()
      ? option.description.trim()
      : label
  if (!label || !description) return null
  return {
    label,
    description,
    ...(typeof option.preview === 'string' ? { preview: option.preview } : {}),
  }
}

function normalizeQuestion(value: unknown, index: number): Record<string, unknown> | null {
  const question = objectValue(value)
  if (!question || typeof question.question !== 'string') return null
  const questionText = question.question.trim()
  if (!questionText || !Array.isArray(question.options)) return null
  const options = question.options
    .map(normalizeQuestionOption)
    .filter((option): option is Record<string, unknown> => option !== null)
  if (options.length < 2 || options.length > 4) return null
  const header =
    typeof question.header === 'string' && question.header.trim()
      ? question.header.trim().slice(0, 12)
      : headerFromQuestion(questionText, index)
  return {
    question: questionText,
    header,
    options,
    ...(typeof question.multiSelect === 'boolean'
      ? { multiSelect: question.multiSelect }
      : {}),
  }
}

function normalizeAskUserQuestionInput(input: Record<string, unknown>): Record<string, unknown> | null {
  if (!Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > 4) {
    return null
  }
  const questions = input.questions.map(normalizeQuestion)
  if (questions.some(question => question === null)) return null
  return {
    questions,
    ...(objectValue(input.metadata) ? { metadata: input.metadata } : {}),
  }
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
    ? value
    : null
}

function numberish(value: unknown): boolean {
  return typeof value === 'number' || typeof value === 'string'
}

function booleanish(value: unknown): boolean {
  return typeof value === 'boolean' || typeof value === 'string'
}

function normalizeBashInput(input: Record<string, unknown>): Record<string, unknown> | null {
  if (
    !sameKeys(input, ['command'], [
      'description',
      'timeout',
      'run_in_background',
      'dangerouslyDisableSandbox',
    ]) ||
    typeof input.command !== 'string' ||
    (input.description !== undefined && typeof input.description !== 'string') ||
    (input.timeout !== undefined && !numberish(input.timeout)) ||
    (input.run_in_background !== undefined && !booleanish(input.run_in_background)) ||
    (input.dangerouslyDisableSandbox !== undefined && !booleanish(input.dangerouslyDisableSandbox))
  ) {
    return null
  }
  return input
}

function normalizeReadInput(input: Record<string, unknown>): Record<string, unknown> | null {
  if (
    !sameKeys(input, ['file_path'], ['offset', 'limit', 'pages']) ||
    typeof input.file_path !== 'string' ||
    (input.offset !== undefined && !numberish(input.offset)) ||
    (input.limit !== undefined && !numberish(input.limit)) ||
    (input.pages !== undefined && typeof input.pages !== 'string')
  ) {
    return null
  }
  return input
}

function normalizeGlobInput(input: Record<string, unknown>): Record<string, unknown> | null {
  if (
    !sameKeys(input, ['pattern'], ['path']) ||
    typeof input.pattern !== 'string' ||
    (input.path !== undefined && typeof input.path !== 'string')
  ) {
    return null
  }
  return input
}

function normalizeGrepInput(input: Record<string, unknown>): Record<string, unknown> | null {
  const optional = [
    'path',
    'glob',
    'type',
    'output_mode',
    '-i',
    '-n',
    '-A',
    '-B',
    '-C',
    'head_limit',
    'multiline',
  ]
  if (
    !sameKeys(input, ['pattern'], optional) ||
    typeof input.pattern !== 'string' ||
    (input.path !== undefined && typeof input.path !== 'string') ||
    (input.glob !== undefined && typeof input.glob !== 'string') ||
    (input.type !== undefined && typeof input.type !== 'string') ||
    (input.output_mode !== undefined && typeof input.output_mode !== 'string') ||
    (input['-i'] !== undefined && !booleanish(input['-i'])) ||
    (input['-n'] !== undefined && !booleanish(input['-n'])) ||
    (input['-A'] !== undefined && !numberish(input['-A'])) ||
    (input['-B'] !== undefined && !numberish(input['-B'])) ||
    (input['-C'] !== undefined && !numberish(input['-C'])) ||
    (input.head_limit !== undefined && !numberish(input.head_limit)) ||
    (input.multiline !== undefined && !booleanish(input.multiline))
  ) {
    return null
  }
  return input
}

function normalizeTaskUpdateInput(input: Record<string, unknown>): Record<string, unknown> | null {
  const updateFields = [
    'subject',
    'description',
    'activeForm',
    'status',
    'addBlocks',
    'addBlockedBy',
    'owner',
    'metadata',
  ]
  const allowedStatuses = new Set(['pending', 'in_progress', 'completed', 'deleted'])
  if (
    !sameKeys(input, ['taskId'], updateFields) ||
    typeof input.taskId !== 'string' ||
    !updateFields.some(field => Object.prototype.hasOwnProperty.call(input, field)) ||
    (input.subject !== undefined && typeof input.subject !== 'string') ||
    (input.description !== undefined && typeof input.description !== 'string') ||
    (input.activeForm !== undefined && typeof input.activeForm !== 'string') ||
    (input.status !== undefined &&
      (typeof input.status !== 'string' || !allowedStatuses.has(input.status))) ||
    (input.addBlocks !== undefined && !stringArray(input.addBlocks)) ||
    (input.addBlockedBy !== undefined && !stringArray(input.addBlockedBy)) ||
    (input.owner !== undefined && typeof input.owner !== 'string') ||
    (input.metadata !== undefined && !objectValue(input.metadata))
  ) {
    return null
  }
  return input
}

function maybeBareJsonToolCall(
  text: string,
  availableToolNames: ToolNameCollection | undefined,
  index: number,
): ParsedToolCall | null {
  const input = parseJsonObject(text)
  if (!input) return null

  if (
    hasTool(availableToolNames, 'TaskCreate') &&
    sameKeys(input, ['subject', 'description'], ['activeForm', 'metadata']) &&
    typeof input.subject === 'string' &&
    typeof input.description === 'string' &&
    (input.activeForm === undefined || typeof input.activeForm === 'string') &&
    (input.metadata === undefined ||
      (typeof input.metadata === 'object' &&
        input.metadata !== null &&
        !Array.isArray(input.metadata)))
  ) {
    return { id: `bare_${Date.now().toString(36)}_${index}`, name: 'TaskCreate', input }
  }

  if (
    hasTool(availableToolNames, 'Write') &&
    sameKeys(input, ['file_path', 'content']) &&
    typeof input.file_path === 'string' &&
    typeof input.content === 'string'
  ) {
    return { id: `bare_${Date.now().toString(36)}_${index}`, name: 'Write', input }
  }

  if (
    hasTool(availableToolNames, 'Edit') &&
    sameKeys(input, ['file_path', 'old_string', 'new_string'], ['replace_all']) &&
    typeof input.file_path === 'string' &&
    typeof input.old_string === 'string' &&
    typeof input.new_string === 'string' &&
    (input.replace_all === undefined || typeof input.replace_all === 'boolean')
  ) {
    return { id: `bare_${Date.now().toString(36)}_${index}`, name: 'Edit', input }
  }

  if (hasTool(availableToolNames, 'AskUserQuestion')) {
    const askInput = normalizeAskUserQuestionInput(input)
    if (askInput) {
      return {
        id: `bare_${Date.now().toString(36)}_${index}`,
        name: 'AskUserQuestion',
        input: askInput,
      }
    }
  }

  if (hasTool(availableToolNames, 'Bash')) {
    const bashInput = normalizeBashInput(input)
    if (bashInput) {
      return {
        id: `bare_${Date.now().toString(36)}_${index}`,
        name: 'Bash',
        input: bashInput,
      }
    }
  }

  if (hasTool(availableToolNames, 'Read')) {
    const readInput = normalizeReadInput(input)
    if (readInput) {
      return {
        id: `bare_${Date.now().toString(36)}_${index}`,
        name: 'Read',
        input: readInput,
      }
    }
  }

  if (hasTool(availableToolNames, 'TaskUpdate')) {
    const taskUpdateInput = normalizeTaskUpdateInput(input)
    if (taskUpdateInput) {
      return {
        id: `bare_${Date.now().toString(36)}_${index}`,
        name: 'TaskUpdate',
        input: taskUpdateInput,
      }
    }
  }

  if (hasTool(availableToolNames, 'Glob')) {
    const globInput = normalizeGlobInput(input)
    if (globInput) {
      return {
        id: `bare_${Date.now().toString(36)}_${index}`,
        name: 'Glob',
        input: globInput,
      }
    }
  }

  if (hasTool(availableToolNames, 'Grep')) {
    const grepInput = normalizeGrepInput(input)
    if (grepInput) {
      return {
        id: `bare_${Date.now().toString(36)}_${index}`,
        name: 'Grep',
        input: grepInput,
      }
    }
  }

  return null
}

export function looksLikeBareJsonToolCallPrefix(text: string): boolean {
  const trimmed = text.trimStart()
  if (trimmed.startsWith('```')) return true
  if (!trimmed.startsWith('{')) return false
  return /^\{\s*"(?:subject|description|file_path|content|old_string|new_string|replace_all|questions|command|taskId|status|pattern|path|glob)"\s*:/.test(trimmed)
}

export function parseBareJsonToolCalls(
  text: string,
  options: TextToolCallParseOptions,
): KimiParseResult {
  if (!text || !options.parseBareJsonToolCalls) return { text, toolCalls: [] }
  const wholeCall = maybeBareJsonToolCall(text, options.availableToolNames, 0)
  if (wholeCall) {
    return { text: '', toolCalls: [wholeCall] }
  }

  const toolCalls: ParsedToolCall[] = []
  let cleaned = ''
  let index = 0
  let searchFrom = 0
  while (searchFrom < text.length) {
    const start = nextBareJsonObjectStart(text, searchFrom)
    if (start === -1) {
      cleaned += text.slice(searchFrom)
      break
    }
    const end = findJsonObjectEnd(text, start)
    if (end === null) {
      const tailCall = maybeBareJsonToolCall(
        text.slice(start),
        options.availableToolNames,
        index,
      )
      if (!tailCall) {
        cleaned += text.slice(searchFrom)
        break
      }
      const lineRange = removableLineRange(text, start, text.length)
      cleaned += text.slice(searchFrom, lineRange?.prefixEnd ?? start)
      toolCalls.push(tailCall)
      index++
      searchFrom = lineRange?.end ?? text.length
      continue
    }
    const candidate = text.slice(start, end)
    const call = maybeBareJsonToolCall(candidate, options.availableToolNames, index)
    if (!call) {
      cleaned += text.slice(searchFrom, start + 1)
      searchFrom = start + 1
      continue
    }
    const lineRange = removableLineRange(text, start, end)
    cleaned += text.slice(searchFrom, lineRange?.prefixEnd ?? start)
    toolCalls.push(call)
    index++
    searchFrom = lineRange?.end ?? end
  }
  return { text: toolCalls.length > 0 ? cleaned.replace(/\n{3,}/g, '\n\n') : text, toolCalls }
}

export function parseTextToolCalls(
  text: string,
  options: TextToolCallParseOptions = {},
): KimiParseResult {
  const kimi = parseKimiToolCalls(text)
  const bare = parseBareJsonToolCalls(kimi.text, options)
  return {
    text: bare.text,
    toolCalls: [...kimi.toolCalls, ...bare.toolCalls],
  }
}
