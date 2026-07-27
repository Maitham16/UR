import { expect, test } from 'bun:test'
import {
  extractFactCandidates,
  factKey,
  filterNovelFacts,
  looksLikeSecret,
  proposeMemories,
} from '../src/memdir/extractFacts.ts'
import {
  actionRequiresApproval,
  appleScriptString,
  buildClickCommand,
  buildScreenshotCommand,
  buildTypeCommand,
  isPointWithin,
  MAX_TYPE_CHARS,
} from '../src/utils/computerUse/commands.ts'
import {
  buildSpeechCommand,
  MAX_SPEECH_CHARS,
  prepareSpeechText,
  speak,
} from '../src/voice/speak.ts'

// --- Memory extraction ----------------------------------------------------

test('extracts durable preferences and conventions', () => {
  const facts = proposeMemories(
    'Always use bun instead of npm in this repo. ' +
      'We follow conventional commits for every message.',
  )
  expect(facts.length).toBe(2)
  expect(facts.map(f => f.rule)).toContain('explicit-always-never')
  expect(facts.map(f => f.type)).toContain('project')
})

test('ignores instructions scoped to the current task', () => {
  // These read like durable rules but are false when replayed later, which is
  // the failure mode that makes automatic memory worse than none.
  for (const message of [
    'For now, always use the staging endpoint.',
    'Just this once, never run the tests.',
    'In this case I prefer the verbose output.',
  ]) {
    expect(proposeMemories(message)).toHaveLength(0)
  }
})

test('never captures credentials', () => {
  expect(looksLikeSecret('api_key = abcdef123456')).toBe(true)
  expect(looksLikeSecret('sk-abcdef1234567890')).toBe(true)
  expect(
    proposeMemories('Always use the token: ghp_abcdefghijklmnop1234'),
  ).toHaveLength(0)
})

test('does not re-propose facts already stored', () => {
  const message = 'I prefer tabs over spaces in this project.'
  expect(proposeMemories(message)).toHaveLength(1)
  expect(proposeMemories(message, ['I prefer tabs over spaces in this project'])).toHaveLength(0)
  // Containment: a broader stored line already covers the candidate.
  expect(
    filterNovelFacts(extractFactCandidates(message), [
      'I prefer tabs over spaces in this project, and always will',
    ]),
  ).toHaveLength(0)
})

test('dedupes within a single message and ranks by confidence', () => {
  const facts = proposeMemories(
    'I prefer squash merges. I prefer squash merges. ' +
      'Never push directly to main.',
  )
  expect(facts).toHaveLength(2)
  expect(facts[0]!.confidence).toBeGreaterThanOrEqual(facts[1]!.confidence)
})

test('ignores ordinary conversation', () => {
  for (const message of [
    'Can you fix the failing test?',
    'What does this function do?',
    'Thanks, that worked.',
    '',
  ]) {
    expect(proposeMemories(message)).toHaveLength(0)
  }
})

test('fact keys normalize case and punctuation', () => {
  expect(factKey('I prefer Bun!')).toBe(factKey('i prefer bun'))
})

// --- Voice output ---------------------------------------------------------

test('speech text drops what cannot be listened to', () => {
  const spoken = prepareSpeechText(
    'Run ```bun test``` then open https://example.com and edit src/app.ts',
  )
  expect(spoken).toContain('code block omitted')
  expect(spoken).toContain('link')
  expect(spoken).not.toContain('https://')
  expect(spoken).not.toContain('src/app.ts')
})

test('speech is capped and prefers a sentence boundary', () => {
  const long = `${'This is a complete sentence. '.repeat(80)}`
  const spoken = prepareSpeechText(long)
  expect(spoken.length).toBeLessThanOrEqual(MAX_SPEECH_CHARS)
  expect(spoken.endsWith('.')).toBe(true)
})

test('speech commands pass text on stdin, never in argv', () => {
  const dangerous = 'hello"; rm -rf /; echo "'
  for (const platform of ['darwin', 'linux', 'win32'] as const) {
    const command = buildSpeechCommand(platform, dangerous)
    expect(command).not.toBeNull()
    expect(command!.stdin).toContain('hello')
    // The payload must never appear in argv, where quoting rules apply.
    expect(command!.args.join(' ')).not.toContain('rm -rf')
  }
})

test('macOS speech honors voice and rate options', () => {
  const command = buildSpeechCommand('darwin', 'hi there friend', {
    voice: 'Samantha',
    rate: 200,
  })
  expect(command!.file).toBe('say')
  expect(command!.args).toEqual(['-v', 'Samantha', '-r', '200', '-f', '-'])
})

test('speaking degrades to silence instead of throwing', async () => {
  const missing = async () => {
    throw new Error('say: command not found')
  }
  const result = await speak('hello', missing, { platform: 'darwin' })
  expect(result.spoken).toBe(false)
  expect(result).toMatchObject({ reason: expect.stringContaining('not found') })

  const nonZero = async () => ({ code: 1, stderr: 'no audio device' })
  expect(await speak('hello', nonZero, { platform: 'darwin' })).toMatchObject({
    spoken: false,
    reason: 'no audio device',
  })

  const ok = async () => ({ code: 0, stderr: '' })
  expect(await speak('hello', ok, { platform: 'darwin' })).toEqual({
    spoken: true,
  })
  // Nothing speakable is a reason, not a crash.
  expect(await speak('```only code```', ok, { platform: 'darwin' })).toMatchObject(
    { spoken: true },
  )
})

// --- Computer use ---------------------------------------------------------

test('screen bounds reject hallucinated coordinates', () => {
  const screen = { width: 1920, height: 1080 }
  expect(isPointWithin({ x: 100, y: 100 }, screen)).toBe(true)
  expect(isPointWithin({ x: 1920, y: 100 }, screen)).toBe(false)
  expect(isPointWithin({ x: -1, y: 0 }, screen)).toBe(false)
  expect(isPointWithin({ x: 1.5, y: 0 }, screen)).toBe(false)
  expect(isPointWithin({ x: Number.NaN, y: 0 }, screen)).toBe(false)
})

test('click and screenshot commands are argv-separated per platform', () => {
  expect(buildScreenshotCommand('darwin', '/tmp/s.png')).toEqual({
    file: 'screencapture',
    args: ['-x', '-o', '/tmp/s.png'],
    requires: 'screencapture',
  })
  expect(buildClickCommand('linux', { x: 12, y: 34 }, 'right').args).toEqual([
    'mousemove',
    '12',
    '34',
    'click',
    '3',
  ])
  expect(buildClickCommand('darwin', { x: 12, y: 34 }).args).toEqual([
    'c:12,34',
  ])
})

test('typed text cannot escape the AppleScript literal', () => {
  // A model-authored string must not be able to terminate the statement and
  // append its own AppleScript.
  const attack = '"; do shell script "rm -rf ~"; --'
  const quoted = appleScriptString(attack)
  expect(quoted.startsWith('"')).toBe(true)
  expect(quoted.endsWith('"')).toBe(true)
  // Every embedded quote is escaped, so no bare `"` closes the literal early.
  expect(/(^|[^\\])"/.test(quoted.slice(1, -1))).toBe(false)

  const command = buildTypeCommand('darwin', attack)
  expect(command!.args).toEqual(['-'])
  expect(command!.stdin).toContain(quoted)
})

test('AppleScript newlines leave the literal via return', () => {
  expect(appleScriptString('a\nb')).toBe('"a" & return & "b"')
})

test('type refuses empty and oversized input', () => {
  expect(buildTypeCommand('darwin', '')).toBeNull()
  expect(buildTypeCommand('darwin', 'x'.repeat(MAX_TYPE_CHARS + 1))).toBeNull()
  expect(buildTypeCommand('linux', 'ok')).not.toBeNull()
})

test('state-changing actions require approval, reads do not', () => {
  expect(actionRequiresApproval({ type: 'screenshot' })).toBe(false)
  expect(
    actionRequiresApproval({ type: 'click', point: { x: 1, y: 1 } }),
  ).toBe(true)
  expect(actionRequiresApproval({ type: 'type', text: 'hi' })).toBe(true)
})
