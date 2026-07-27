/**
 * Spoken output for voice mode.
 *
 * Every supported platform ships a speech synthesiser, so this shells out
 * rather than adding a dependency. The exec is injected: command construction
 * is pure and unit-testable, while the audio device is only touched at run
 * time on a real machine.
 */

export type SpeechExec = (
  file: string,
  args: string[],
  input: string,
) => Promise<{ code: number; stderr: string }>

export type SpeechPlatform = 'darwin' | 'linux' | 'win32'

export type SpeechCommand = {
  file: string
  args: string[]
  /** Text delivered on stdin rather than argv, so it is never shell-parsed. */
  stdin: string
}

/** Hard cap: a runaway response should not narrate for minutes. */
export const MAX_SPEECH_CHARS = 1000

/**
 * Strip what should never be read aloud. Code blocks, URLs and file paths are
 * unlistenable character-by-character, and reading them wastes the user's time
 * more than it informs.
 */
export function prepareSpeechText(raw: string): string {
  const cleaned = raw
    .replace(/```[\s\S]*?```/g, ' code block omitted. ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' link ')
    // Absolute/home-relative paths, and bare relative ones like `src/app.ts`.
    // Requiring an extension on the relative form keeps prose such as
    // "and/or" from being swallowed.
    .replace(/(^|\s)(?:[~.]?\/\S+|\S+\/\S*\.\w{1,5})(?=\s|$)/g, ' path ')
    .replace(/[*_#>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length <= MAX_SPEECH_CHARS) return cleaned
  // Cut on a sentence boundary when one is close to the limit, so speech ends
  // on a complete thought rather than mid-word.
  const window = cleaned.slice(0, MAX_SPEECH_CHARS)
  const lastStop = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('! '),
    window.lastIndexOf('? '),
  )
  return lastStop > MAX_SPEECH_CHARS * 0.6
    ? window.slice(0, lastStop + 1)
    : `${window.trimEnd()}…`
}

/**
 * Build the synthesiser invocation for a platform. Text always travels on
 * stdin: passing it in argv would expose it to shell quoting rules and, on a
 * long response, to argument-length limits.
 */
export function buildSpeechCommand(
  platform: SpeechPlatform,
  text: string,
  options: { voice?: string; rate?: number } = {},
): SpeechCommand | null {
  const speech = prepareSpeechText(text)
  if (!speech) return null
  switch (platform) {
    case 'darwin': {
      const args: string[] = []
      if (options.voice) args.push('-v', options.voice)
      if (options.rate) args.push('-r', String(options.rate))
      args.push('-f', '-')
      return { file: 'say', args, stdin: speech }
    }
    case 'linux': {
      const args = ['-e']
      if (options.rate) args.push('-r', String(options.rate))
      return { file: 'spd-say', args, stdin: speech }
    }
    case 'win32':
      return {
        file: 'powershell',
        args: [
          '-NoProfile',
          '-Command',
          // Reads stdin; the text is never interpolated into the script.
          "Add-Type -AssemblyName System.Speech; " +
            "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; " +
            '$s.Speak([Console]::In.ReadToEnd())',
        ],
        stdin: speech,
      }
  }
}

export type SpeakResult =
  | { spoken: true }
  | { spoken: false; reason: string }

/**
 * Speak a response. Failure is never fatal: a missing synthesiser should
 * degrade to silence, not interrupt the session.
 */
export async function speak(
  text: string,
  exec: SpeechExec,
  options: {
    platform?: SpeechPlatform
    voice?: string
    rate?: number
  } = {},
): Promise<SpeakResult> {
  const platform = options.platform ?? (process.platform as SpeechPlatform)
  if (platform !== 'darwin' && platform !== 'linux' && platform !== 'win32') {
    return { spoken: false, reason: `unsupported platform ${platform}` }
  }
  const command = buildSpeechCommand(platform, text, options)
  if (!command) return { spoken: false, reason: 'nothing speakable in text' }
  try {
    const result = await exec(command.file, command.args, command.stdin)
    if (result.code !== 0) {
      return {
        spoken: false,
        reason: result.stderr.trim() || `${command.file} exited ${result.code}`,
      }
    }
    return { spoken: true }
  } catch (error) {
    return {
      spoken: false,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}
