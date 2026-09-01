import { createHash } from 'crypto'
import { appendFile, mkdir, readFile } from 'fs/promises'
import { dirname } from 'path'
import { getSessionId } from '../../bootstrap/state.js'
import type { Message } from '../../types/message.js'
import { getAutoMemDailyLogPath } from '../../memdir/paths.js'
import { getErrnoCode } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { stripSystemReminders } from '../../utils/systemReminderFilter.js'

export type ReducedTranscriptEntry = {
  role: 'user' | 'assistant'
  text: string
  timestamp: Date
  messageId: string
  sessionId: string
}

let writeChain: Promise<void> = Promise.resolve()

type TranscriptIO = {
  read(path: string): Promise<string>
  mkdir(path: string): Promise<void>
  append(path: string, content: string): Promise<void>
}

const defaultTranscriptIO: TranscriptIO = {
  read: path => readFile(path, 'utf8'),
  mkdir: path => mkdir(path, { recursive: true }).then(() => undefined),
  append: (path, content) => appendFile(path, content, 'utf8'),
}

let transcriptIO = defaultTranscriptIO

function asDate(timestamp: Message['timestamp']): Date {
  const date = timestamp === undefined ? new Date() : new Date(timestamp)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

export function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function cleanText(text: string): string {
  return text.replace(/\r\n/g, '\n').trim()
}

const GENERATED_USER_BLOCK =
  /^\s*<(tick|task_notification|command-name|local-command|ide_opened_file|ide_selection|session-start-hook|channel)(?:\s[^>]*)?>[\s\S]*<\/\1>\s*$/i

function cleanUserText(text: string): string | null {
  const withoutReminders = stripSystemReminders(text)
  const cleaned = cleanText(withoutReminders)
  if (!cleaned || GENERATED_USER_BLOCK.test(cleaned)) return null
  return cleaned
}

function userText(message: Message): string | null {
  if (
    message.type !== 'user' ||
    message.isMeta ||
    message.isCompactSummary ||
    message.isVirtual ||
    message.isVisibleInTranscriptOnly ||
    message.toolUseResult !== undefined ||
    (message.origin !== undefined &&
      typeof message.origin !== 'string' &&
      message.origin.kind !== undefined &&
      message.origin.kind !== 'human')
  ) {
    return null
  }
  const content = message.message?.content
  if (typeof content === 'string') return cleanUserText(content)
  if (!Array.isArray(content)) return null
  const text = content
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => stripSystemReminders(block.text as string))
    .join('\n')
  return cleanUserText(text)
}

function assistantTexts(message: Message): string[] {
  if (
    message.type !== 'assistant' ||
    message.isApiErrorMessage ||
    message.isMeta ||
    message.isCompactSummary ||
    message.isVirtual
  )
    return []
  const content = message.message?.content
  if (!Array.isArray(content)) return []

  const userFacingToolMessages: string[] = []
  const plainText: string[] = []
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      const text = cleanText(block.text)
      if (text) plainText.push(text)
      continue
    }
    if (block?.type !== 'tool_use') continue
    if (block.name !== 'SendUserMessage' && block.name !== 'SendUserFile') continue
    const input = block.input as Record<string, unknown> | undefined
    const candidate = input?.message ?? input?.caption ?? input?.text
    if (typeof candidate === 'string' && cleanText(candidate)) {
      userFacingToolMessages.push(cleanText(candidate))
    }
  }

  // Assistant/brief sessions put the actual reply in SendUserMessage. Avoid
  // duplicating hidden working narration when that tool is present.
  return userFacingToolMessages.length > 0 ? userFacingToolMessages : plainText
}

export function reduceTranscriptMessages(
  messages: readonly Message[],
): ReducedTranscriptEntry[] {
  const result: ReducedTranscriptEntry[] = []
  const sessionId = getSessionId()
  for (const message of messages) {
    const timestamp = asDate(message.timestamp)
    const stableMessageId =
      message.uuid ??
      message.message?.id ??
      message.requestId ??
      message.clientRequestId ??
      createHash('sha256')
        .update(
          `${String(message.timestamp ?? '')}\0${message.type}\0${JSON.stringify(message.message?.content ?? message.content ?? null)}`,
        )
        .digest('hex')
        .slice(0, 20)
    if (message.type === 'user') {
      const text = userText(message)
      if (text) {
        result.push({
          role: 'user',
          text,
          timestamp,
          messageId: stableMessageId,
          sessionId,
        })
      }
      continue
    }
    if (message.type === 'assistant') {
      const texts = assistantTexts(message)
      for (let textIndex = 0; textIndex < texts.length; textIndex++) {
        result.push({
          role: 'assistant',
          text: texts[textIndex]!,
          timestamp,
          messageId: `${stableMessageId}:${textIndex}`,
          sessionId,
        })
      }
    }
  }
  return result
}

function quoteMarkdown(text: string): string {
  return text
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n')
}

function entryId(entry: ReducedTranscriptEntry): string {
  return createHash('sha256')
    .update(`${entry.messageId}\0${entry.role}\0${entry.text}`)
    .digest('hex')
    .slice(0, 20)
}

export function transcriptEntryMarker(entry: ReducedTranscriptEntry): string {
  return `<!-- ur-session-transcript-entry:${entry.sessionId}:${entryId(entry)} -->`
}

export function formatTranscriptSegment(
  entries: readonly ReducedTranscriptEntry[],
): string {
  if (entries.length === 0) return ''
  const lines = [
    `## Session transcript · ${entries[0]!.timestamp.toLocaleTimeString()}`,
    '',
  ]
  for (const entry of entries) {
    lines.push(
      `**${entry.role === 'user' ? 'User' : 'Assistant'} · ${entry.timestamp.toLocaleTimeString()}**`,
      '',
      quoteMarkdown(entry.text),
      transcriptEntryMarker(entry),
      '',
    )
  }
  return `${lines.join('\n').trimEnd()}\n\n`
}

async function appendDateBucket(
  date: Date,
  entries: readonly ReducedTranscriptEntry[],
): Promise<void> {
  if (entries.length === 0) return
  const path = getAutoMemDailyLogPath(date)
  let existing = ''
  try {
    existing = await transcriptIO.read(path)
  } catch (error) {
    if (getErrnoCode(error) !== 'ENOENT') throw error
  }
  const missing = entries.filter(
    entry => !existing.includes(transcriptEntryMarker(entry)),
  )
  if (missing.length === 0) return
  await transcriptIO.mkdir(dirname(path))
  // Markers follow their entry. If an append is interrupted, retrying may
  // duplicate an incomplete prefix but can never mistake it for a complete
  // persisted entry and silently lose the remainder.
  await transcriptIO.append(path, formatTranscriptSegment(missing))
}

async function writeEntries(entries: readonly ReducedTranscriptEntry[]): Promise<void> {
  const buckets = new Map<string, ReducedTranscriptEntry[]>()
  const bucketDates = new Map<string, Date>()
  for (const entry of entries) {
    const key = localDateKey(entry.timestamp)
    const bucket = buckets.get(key) ?? []
    bucket.push(entry)
    buckets.set(key, bucket)
    bucketDates.set(key, entry.timestamp)
  }
  for (const [key, bucket] of [...buckets.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    await appendDateBucket(bucketDates.get(key)!, bucket)
  }
}

function enqueueWrite(entries: readonly ReducedTranscriptEntry[]): Promise<void> {
  writeChain = writeChain.then(() => writeEntries(entries)).catch(error => {
    logError(error instanceof Error ? error : new Error(String(error)))
  })
  return writeChain
}

export function writeSessionTranscriptSegment(
  messages: readonly Message[],
): Promise<void> {
  return enqueueWrite(reduceTranscriptMessages(messages))
}

/** Flush only completed local-date buckets; today's live segment is left open. */
export function flushOnDateChange(
  messages: readonly Message[],
  currentDate: string,
): Promise<void> {
  const entries = reduceTranscriptMessages(messages).filter(
    entry => localDateKey(entry.timestamp) < currentDate,
  )
  return enqueueWrite(entries)
}

export async function flushSessionTranscriptWrites(): Promise<void> {
  await writeChain
}

/** Replace filesystem operations in focused failure/retry tests. */
export function setSessionTranscriptIOForTests(
  overrides?: Partial<TranscriptIO>,
): void {
  transcriptIO = overrides
    ? { ...defaultTranscriptIO, ...overrides }
    : defaultTranscriptIO
  writeChain = Promise.resolve()
}
