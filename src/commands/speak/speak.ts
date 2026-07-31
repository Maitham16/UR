import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'
import {
  buildSpeechCommand,
  prepareSpeechText,
  type SpeechExec,
  type SpeechPlatform,
  speak,
} from '../../voice/speak.js'

/** Text goes on stdin, so it is never parsed as shell source. */
const exec: SpeechExec = async (file, args, input) => {
  const result = await execFileNoThrow(file, args, {
    input,
    stdin: 'pipe',
    timeout: 120_000,
    preserveOutputOnError: true,
  })
  return { code: result.code, stderr: result.stderr }
}

function flagValue(tokens: string[], flag: string): string | undefined {
  const index = tokens.indexOf(flag)
  return index >= 0 ? tokens[index + 1] : undefined
}

export const call: LocalCommandCall = async (args: string) => {
  // parseArguments, not split(): shell wiring quotes each argument.
  const tokens = parseArguments(args)
  const voice = flagValue(tokens, '--voice')
  const rawRate = flagValue(tokens, '--rate')
  const rate = rawRate ? Number.parseInt(rawRate, 10) : undefined
  if (rawRate !== undefined && !Number.isFinite(rate)) {
    return { type: 'text', value: '--rate expects a number (words per minute)' }
  }

  // Strip flags and their values; everything else is the text to speak.
  const text = tokens
    .filter((token, index) => {
      if (token === '--voice' || token === '--rate') return false
      const previous = tokens[index - 1]
      return previous !== '--voice' && previous !== '--rate'
    })
    .join(' ')

  if (!text) {
    return {
      type: 'text',
      value: 'Usage: /speak <text> [--voice <name>] [--rate <wpm>]',
    }
  }

  const platform = process.platform as SpeechPlatform
  const preview = prepareSpeechText(text)
  const command = buildSpeechCommand(platform, text, { voice, rate })
  if (!command) {
    return {
      type: 'text',
      value:
        platform === 'darwin' || platform === 'linux' || platform === 'win32'
          ? 'Nothing speakable in that text (code, links and paths are skipped).'
          : `Speech is not supported on ${platform}.`,
    }
  }

  const result = await speak(text, exec, { platform, voice, rate })
  if (!result.spoken) {
    const hint =
      platform === 'linux'
        ? '\nInstall a synthesiser, for example: apt install speech-dispatcher'
        : ''
    return { type: 'text', value: `Could not speak: ${result.reason}${hint}` }
  }
  return {
    type: 'text',
    value: `Spoke ${preview.length} characters via ${command.file}.`,
  }
}
