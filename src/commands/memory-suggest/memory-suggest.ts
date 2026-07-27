import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { proposeMemories } from '../../memdir/extractFacts.js'
import { getAutoMemPath, isAutoMemoryEnabled } from '../../memdir/paths.js'
import { listMemory } from '../../ur/notes.js'
import { getCwd } from '../../utils/cwd.js'
import {
  getTranscriptPath,
  MAX_TRANSCRIPT_READ_BYTES,
} from '../../utils/sessionStorage.js'

/**
 * Everything already remembered, so a candidate the user has recorded is never
 * offered back to them. Covers the three places memory lives: the notes store
 * `/remember` writes to, the project UR.md files, and the auto-memory dir.
 * Each source is best-effort — a missing or unreadable one narrows the dedup
 * rather than failing the command.
 */
function existingMemoryLines(cwd: string): string[] {
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

function flagValue(tokens: string[], flag: string): string | undefined {
  const index = tokens.indexOf(flag)
  return index >= 0 ? tokens[index + 1] : undefined
}

/** Pull the plain text of recent user messages out of the transcript. */
function recentUserMessages(path: string, limit: number): string[] {
  if (!existsSync(path)) return []
  const raw = readFileSync(path, 'utf8')
  if (raw.length > MAX_TRANSCRIPT_READ_BYTES) return []
  const messages: string[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    const record = entry as {
      type?: string
      message?: { role?: string; content?: unknown }
    }
    if (record.type !== 'user') continue
    const content = record.message?.content
    if (typeof content === 'string') {
      messages.push(content)
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (
          part &&
          typeof part === 'object' &&
          (part as { type?: string }).type === 'text' &&
          typeof (part as { text?: string }).text === 'string'
        ) {
          messages.push((part as { text: string }).text)
        }
      }
    }
  }
  return messages.slice(-limit)
}

export const call: LocalCommandCall = async (args: string) => {
  // parseArguments, not split(): shell wiring quotes each argument.
  const tokens = parseArguments(args)
  const turns = Number.parseInt(flagValue(tokens, '--turns') ?? '30', 10)
  const minConfidence = Number.parseFloat(
    flagValue(tokens, '--min-confidence') ?? '0.75',
  )
  if (!Number.isFinite(turns) || turns < 1) {
    return { type: 'text', value: '--turns expects a positive integer' }
  }
  if (!Number.isFinite(minConfidence)) {
    return { type: 'text', value: '--min-confidence expects a number' }
  }

  const messages = recentUserMessages(getTranscriptPath(), turns)
  if (messages.length === 0) {
    return {
      type: 'text',
      value: 'No user messages found in this session yet.',
    }
  }

  // Seeded with what is already stored, so a fact the user has recorded is
  // never proposed back. Proposals then accumulate across turns, with each
  // round told about the previous ones so the same fact is not offered twice.
  const known = existingMemoryLines(getCwd())
  const accepted: string[] = [...known]
  const proposals: string[] = []
  for (const message of messages) {
    for (const fact of proposeMemories(message, accepted, minConfidence)) {
      accepted.push(fact.text)
      proposals.push(
        `  [${fact.type}, ${fact.confidence.toFixed(2)}, ${fact.rule}]\n    ${fact.text}`,
      )
    }
  }

  if (proposals.length === 0) {
    return {
      type: 'text',
      value: `Scanned ${messages.length} user message(s); nothing durable enough to remember.`,
    }
  }
  return {
    type: 'text',
    value: [
      `Scanned ${messages.length} user message(s). Candidate memories:`,
      '',
      ...proposals,
      '',
      'These are proposals only; nothing was saved.',
      'Keep one with: /remember <text>',
    ].join('\n'),
  }
}
