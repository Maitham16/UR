import { loadTranscript, type MessageLike } from '../../services/agents/inspector.js'
import {
  formatTrajectoryGrade,
  gradeTrajectory,
} from '../../services/agents/trajectoryGrader.js'
import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'

export const call: LocalCommandCall = async (args, context) => {
  const tokens = parseArguments(args ?? '')
  const json = tokens.includes('--json')
  const fileIndex = tokens.indexOf('--file')
  const minIndex = tokens.indexOf('--min-score')
  const minScore = minIndex >= 0 ? Number(tokens[minIndex + 1]) : null

  let messages: MessageLike[]
  if (fileIndex >= 0 && tokens[fileIndex + 1]) {
    try {
      messages = loadTranscript(tokens[fileIndex + 1]!)
    } catch (error) {
      return {
        type: 'text',
        value: error instanceof Error ? error.message : String(error),
      }
    }
  } else {
    messages = (context as { messages?: MessageLike[] } | undefined)?.messages ?? []
    if (messages.length === 0) {
      return {
        type: 'text',
        value:
          'No messages to grade. Run inside a session, or pass a transcript: ur grade-trajectory --file <path.jsonl>',
      }
    }
  }

  const grade = gradeTrajectory(messages)
  const rendered = formatTrajectoryGrade(grade, json)

  // A gate that cannot fail is decoration. runLocalTextCommand exits with
  // `process.exitCode ?? 0`, so the exit status has to be set here — a
  // returned `exitCode` field is silently ignored and the CI step passes
  // while printing FAILED.
  if (minScore !== null && Number.isFinite(minScore) && grade.overall < minScore) {
    process.exitCode = 1
    return {
      type: 'text',
      value: `${rendered}\n\nFAILED: trajectory scored ${grade.overall}, below the required ${minScore}.`,
    }
  }
  return { type: 'text', value: rendered }
}
