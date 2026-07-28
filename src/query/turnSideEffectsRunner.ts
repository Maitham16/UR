import type {
  AssistantMessage,
  Message,
  SystemMessage,
} from '../types/message.js'
import { execFileNoThrow } from '../utils/execFileNoThrow.js'
import { createSystemMessage } from '../utils/messages.js'
import type { SpeechExec } from '../voice/speak.js'
import {
  buildMemorySuggestion,
  maybeSpeakResponse,
  resolveTurnSideEffects,
} from './turnSideEffects.js'

const exec: SpeechExec = async (file, args, input) => {
  const result = await execFileNoThrow(file, args, {
    input,
    stdin: 'pipe',
    timeout: 120_000,
    preserveOutputOnError: true,
  })
  return { code: result.code, stderr: result.stderr }
}

/** Plain text of a message, ignoring tool blocks and images. */
function textOf(message: { message?: { content?: unknown } }): string {
  const content = message.message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(
      (part): part is { type: 'text'; text: string } =>
        Boolean(part) &&
        typeof part === 'object' &&
        (part as { type?: string }).type === 'text' &&
        typeof (part as { text?: string }).text === 'string',
    )
    .map(part => part.text)
    .join('\n')
}

/**
 * Run the opt-in end-of-turn effects. Both default to off, so this is a cheap
 * settings read and an early return for anyone who has not enabled them.
 */
export async function runTurnSideEffects(
  messagesForQuery: Message[],
  assistantMessages: AssistantMessage[],
  appendSystemMessage?: (message: SystemMessage) => void,
): Promise<{ spoke: boolean; suggestion: string | null }> {
  const config = resolveTurnSideEffects()
  if (!config.speakResponses && !config.suggestMemories) {
    return { spoke: false, suggestion: null }
  }

  const reply = assistantMessages.map(textOf).join('\n').trim()
  const spoke = maybeSpeakResponse(reply, exec, config)

  let suggestion: string | null = null
  if (config.suggestMemories) {
    const lastUser = [...messagesForQuery]
      .reverse()
      .find(message => (message as { type?: string }).type === 'user')
    const userText = lastUser ? textOf(lastUser as never) : ''
    if (userText) {
      const { existingMemoryLines } = await import(
        '../commands/memory-suggest/memoryLines.js'
      )
      suggestion = buildMemorySuggestion(userText, existingMemoryLines(), config)
      if (suggestion) {
        // stderr is not the Ink transcript: under the REPL it lands outside
        // the rendered frame and is overwritten on the next repaint, so the
        // suggestion was effectively invisible. appendSystemMessage is the
        // same channel the neighbouring stop hooks use.
        if (appendSystemMessage) {
          appendSystemMessage(createSystemMessage(suggestion, 'info'))
        } else {
          // Headless (`ur -p`) has no transcript to append to.
          process.stderr.write(`\n${suggestion}\n`)
        }
      }
    }
  }
  return { spoke, suggestion }
}
