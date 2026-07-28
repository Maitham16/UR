import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { ComputerTool } from '../src/tools/ComputerTool/ComputerTool.tsx'
import { describeInput } from '../src/tools/ComputerTool/UI.tsx'
import {
  buildMemorySuggestion,
  maybeSpeakResponse,
  resolveTurnSideEffects,
} from '../src/query/turnSideEffects.ts'

// These assert the *wiring*, not the modules. Every one of these features was
// built, tested and then left unreachable; the unit tests all passed while the
// agent got no benefit. This file exists to catch that specific failure.

// --- Injection defenses are actually reached ------------------------------

test('WebFetch wraps fetched content before it reaches the model', () => {
  const source = readFileSync('src/tools/WebFetchTool/WebFetchTool.ts', 'utf8')
  expect(source).toContain('wrapUntrusted')
  // Must happen in the function that builds the tool_result block: that is the
  // single choke point every fetch return path passes through.
  const mapper = source.slice(
    source.indexOf('mapToolResultToToolResultBlockParam'),
  )
  expect(mapper.slice(0, 500)).toContain('wrapUntrusted')
})

test('WebSearch wraps results but keeps the citation reminder outside', () => {
  const source = readFileSync(
    'src/tools/WebSearchTool/WebSearchTool.ts',
    'utf8',
  )
  expect(source).toContain('wrapUntrusted')
  const mapper = source.slice(
    source.indexOf('mapToolResultToToolResultBlockParam'),
  )
  // The reminder is UR's own instruction; wrapping it would label it as
  // untrusted data and invite the model to ignore it.
  const reminderIndex = mapper.indexOf('REMINDER')
  const wrapIndex = mapper.indexOf('wrapUntrusted')
  expect(wrapIndex).toBeGreaterThan(-1)
  expect(reminderIndex).toBeGreaterThan(wrapIndex)
})

// --- Computer tool is agent-reachable -------------------------------------

test('the Computer tool is registered and gated correctly', () => {
  expect(ComputerTool.name).toBe('Computer')
  expect(readFileSync('src/tools.ts', 'utf8')).toContain('ComputerTool')
  // Input events land in whichever window has focus, so two at once interleave.
  expect(ComputerTool.isConcurrencySafe({ action: 'click' } as never)).toBe(
    false,
  )
  expect(ComputerTool.isReadOnly({ action: 'click' } as never)).toBe(false)
})

test('reading the screen is allowed; changing the machine asks', async () => {
  expect(
    (await ComputerTool.checkPermissions({ action: 'screenshot' } as never))
      .behavior,
  ).toBe('allow')
  for (const input of [
    { action: 'click', x: 10, y: 20 },
    { action: 'type', text: 'rm -rf /' },
  ]) {
    expect(
      (await ComputerTool.checkPermissions(input as never)).behavior,
    ).toBe('ask')
  }
})

test('typed text is never echoed in the UI', () => {
  // A user dictating a password must not see it rendered in the transcript.
  const rendered = describeInput({ action: 'type', text: 'hunter2-secret' })
  expect(rendered).not.toContain('hunter2')
  expect(rendered).toBe('type 14 chars')
})

// --- Turn side effects ----------------------------------------------------

test('both turn side effects default to off', () => {
  const config = resolveTurnSideEffects({} as never)
  expect(config.speakResponses).toBe(false)
  expect(config.suggestMemories).toBe(false)
  expect(config.minConfidence).toBe(0.75)
})

test('settings enable them and bad values fall back', () => {
  const on = resolveTurnSideEffects({
    voice: { speakResponses: true, name: 'Samantha', rate: 210 },
    memory: { suggest: true, suggestMinConfidence: 0.9 },
  } as never)
  expect(on).toMatchObject({
    speakResponses: true,
    voice: 'Samantha',
    rate: 210,
    suggestMemories: true,
    minConfidence: 0.9,
  })
  const bad = resolveTurnSideEffects({
    voice: { speakResponses: true, rate: -5 },
    memory: { suggest: true, suggestMinConfidence: 42 },
  } as never)
  expect(bad.rate).toBeUndefined()
  expect(bad.minConfidence).toBe(0.75)
})

test('speech is skipped when off and never blocks the turn', () => {
  let called = 0
  const exec = async () => {
    called++
    return { code: 0, stderr: '' }
  }
  const off = resolveTurnSideEffects({} as never)
  expect(maybeSpeakResponse('hello', exec, off)).toBe(false)
  expect(called).toBe(0)

  const on = resolveTurnSideEffects({
    voice: { speakResponses: true },
  } as never)
  // Returns synchronously: synthesis is fire-and-forget, so a long reply
  // cannot hold up the next prompt.
  expect(maybeSpeakResponse('hello there', exec, on, 'darwin')).toBe(true)
  expect(maybeSpeakResponse('   ', exec, on, 'darwin')).toBe(false)
})

test('memory suggestions respect the toggle, dedup, and stay proposals', () => {
  const off = resolveTurnSideEffects({} as never)
  expect(buildMemorySuggestion('I always use bun here', [], off)).toBeNull()

  const on = resolveTurnSideEffects({ memory: { suggest: true } } as never)
  const suggestion = buildMemorySuggestion('I always use bun here', [], on)
  expect(suggestion).toContain('Worth remembering?')
  expect(suggestion).toContain('/remember')

  // Already stored → nothing to offer.
  expect(
    buildMemorySuggestion('I always use bun here', ['I always use bun here'], on),
  ).toBeNull()
  // Ordinary conversation → nothing to offer.
  expect(buildMemorySuggestion('fix the failing test', [], on)).toBeNull()
})

test('turn side effects run on the main thread only', () => {
  const source = readFileSync('src/query/stopHooks.ts', 'utf8')
  expect(source).toContain('runTurnSideEffects')
  // A subagent finishing must not narrate or offer to remember.
  const index = source.indexOf('runTurnSideEffects')
  expect(source.slice(index - 400, index)).toContain('!toolUseContext.agentId')
})

// --- Screenshots must reach the model as an image -------------------------

test('a screenshot is returned as an image block, not a byte count', () => {
  // Returning only "Captured 5164460 bytes" leaves the model blind: it then
  // asks the user to save the file, which defeats the tool entirely.
  const result = ComputerTool.mapToolResultToToolResultBlockParam(
    {
      action: 'screenshot',
      ok: true,
      detail: 'Captured the screen (184320 bytes sent)',
      screenshotPath: '/tmp/s.png',
      imageBase64: 'iVBORw0KGgo=',
      imageMediaType: 'image/png',
    } as never,
    'tu_1',
  )
  expect(Array.isArray(result.content)).toBe(true)
  const blocks = result.content as Array<{ type: string }>
  expect(blocks.map(block => block.type)).toEqual(['text', 'image'])
  expect((blocks[1] as never as { source: { media_type: string } }).source
    .media_type).toBe('image/png')
})

test('non-image actions still return plain text', () => {
  const result = ComputerTool.mapToolResultToToolResultBlockParam(
    { action: 'click', ok: true, detail: 'Clicked at 10,20' } as never,
    'tu_2',
  )
  expect(typeof result.content).toBe('string')
  expect(result.content).toContain('Clicked at 10,20')
})

test('an unencodable capture still hands back the path to read', () => {
  // Encoding can fail on a huge or exotic capture. The file is on disk, so the
  // model must be told where, rather than being left with nothing.
  const result = ComputerTool.mapToolResultToToolResultBlockParam(
    {
      action: 'screenshot',
      ok: true,
      detail: 'Captured 900 bytes to /tmp/s.png, but the image could not be encoded (boom). Read that path to view it.',
      screenshotPath: '/tmp/s.png',
    } as never,
    'tu_3',
  )
  expect(result.content).toContain('/tmp/s.png')
})
