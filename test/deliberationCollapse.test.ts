import { describe, expect, test } from 'bun:test'
import {
  describeCollapsedDeliberation,
  STREAMING_REASONING_RAIL,
  StreamingDeliberationProjector,
  splitDeliberationRegion,
  splitLeadingDeliberation,
} from '../src/utils/deliberationText.js'

/**
 * Models without a thinking channel emit reasoning as ordinary assistant text.
 * This is display-only: nothing is deleted, the transcript and the next
 * request carry the text unchanged.
 */
describe('leading deliberation is collapsed, conclusions are not', () => {
  const real = [
    'Wait: the error line 560 is inside Enemy.types.tank.update. e.y should be writable. So why readonly?',
    'Possibility: Object.assign(this, cfg) also copies shape and color. Maybe class fields are non-writable in Safari?',
    'Another possibility: the line numbers do not match exactly.',
    'Let me read more of the file.',
    'I refactored the Enemy constructor to assign properties individually. That removes the Safari failure.',
  ].join('\n\n')

  test('the preamble collapses and the conclusion stays', () => {
    const { deliberation, visible } = splitLeadingDeliberation(real)

    expect(deliberation.split(/\n{2,}/)).toHaveLength(4)
    expect(visible).toStartWith('I refactored')
  })

  test('the placeholder says how much was hidden', () => {
    const { deliberation } = splitLeadingDeliberation(real)
    expect(describeCollapsedDeliberation(deliberation)).toContain('4 paragraphs')
  })

  test('a short answer is untouched', () => {
    expect(splitLeadingDeliberation('Fixed the parser. Tests pass.').deliberation).toBe('')
  })

  test('one self-correction is worth reading, so it stays', () => {
    expect(
      splitLeadingDeliberation('Wait, that is wrong.\n\nThe fix is in parser.ts:40.')
        .deliberation,
    ).toBe('')
  })

  test('an all-deliberation turn is left alone rather than blanked', () => {
    expect(
      splitLeadingDeliberation('Wait.\n\nMaybe.\n\nHmm, could it be?').deliberation,
    ).toBe('')
  })
})

describe('embedded planning dumps are condensed behind a reasoning rail', () => {
  const leaked = [
    'I can see this is a legitimate browser game. The requested enhancements are clear.',
    '- Hold Space to fire\n- Release Space for nova\n- Add collectible powers',
    'This is a large refactor. I should plan and then implement in the same file. Per guidance, I should consider plan mode before changing behavior.',
    'Wait, the user already gave clear direction. Let me decide whether EnterPlanMode is necessary and whether I should ask another question.',
    'Actually, I think I can proceed directly. I need to create tasks before editing and then verify the game.',
    'I will implement the requested controls and powers now.',
  ].join('\n\n')

  test('keeps the useful summary and list while hiding self-talk', () => {
    const split = splitDeliberationRegion(leaked)
    expect(split.before).toContain('legitimate browser game')
    expect(split.before).toContain('Hold Space to fire')
    expect(split.deliberation).toContain('EnterPlanMode')
    expect(split.after).toContain('implement the requested controls')
  })

  test('rail is compact, styled, and explicitly expandable', () => {
    const split = splitDeliberationRegion(leaked)
    const rail = describeCollapsedDeliberation(split.deliberation)
    expect(rail).toContain('> ∴ **Reasoning condensed**')
    expect(rail).toContain('planning approach and task order')
    expect(rail).toContain('ctrl+o')
    expect(rail.length).toBeLessThan(180)
  })

  test('large all-reasoning text stays linear and moves behind the rail', () => {
    const large = Array.from(
      { length: 10_000 },
      (_, index) => `Wait, I should inspect planning choice ${index}.`,
    ).join('\n\n')
    const started = performance.now()
    const split = splitDeliberationRegion(large)
    const elapsed = performance.now() - started

    expect(split.deliberation).toBe(large)
    expect(split.before).toBe('')
    expect(split.after).toBe('')
    // This intentionally generous ceiling catches an accidental return to the
    // old quadratic scan without making ordinary busy CI machines flaky.
    expect(elapsed).toBeLessThan(1_000)
  })
})

describe('streaming deliberation never flashes before it is condensed', () => {
  test('withholds an undecided paragraph and exposes only completed answer text', () => {
    const projector = new StreamingDeliberationProjector()

    expect(projector.project('The parser is fixed.')).toBe('')
    expect(projector.project('The parser is fixed.\n\nTests are runn')).toBe(
      'The parser is fixed.',
    )
    expect(
      projector.project('The parser is fixed.\n\nTests are running.\n\n'),
    ).toBe('The parser is fixed.\n\nTests are running.')
  })

  test('replaces the first completed planning paragraph with one stable rail', () => {
    const projector = new StreamingDeliberationProjector()
    const summary = 'The requested game controls are clear.'
    const planning =
      'This is a large refactor. I should enter plan mode, and I need to create tasks before editing.'

    expect(projector.project(`${summary}\n\n${planning}`)).toBe(summary)
    expect(projector.project(`${summary}\n\n${planning}\n\nWait, let me reconsider.`)).toBe(
      `${summary}\n\n${STREAMING_REASONING_RAIL}`,
    )

    const stable = projector.project(
      `${summary}\n\n${planning}\n\nWait, let me reconsider.\n\nActually, I will proceed.\n\n`,
    )
    expect(stable).toBe(`${summary}\n\n${STREAMING_REASONING_RAIL}`)
    expect(stable).not.toContain('enter plan mode')
    expect(stable).not.toContain('Wait')
  })

  test('does not classify prose inside a fenced code block as planning', () => {
    const projector = new StreamingDeliberationProjector()
    const code = '```ts\nif (ready) {\n  // I should keep this comment\n}'
    const rendered = projector.project(`${code}\n\n\`\`\`\n\nDone.\n\n`)

    expect(rendered).toContain('I should keep this comment')
    expect(rendered).not.toContain(STREAMING_REASONING_RAIL)
  })
})

describe('structure and ordinary prose are never collapsed', () => {
  for (const [label, body] of [
    ['a code fence', '```js\nconst x = 1\n```'],
    ['a list', '- item one\n- item two'],
    ['a heading', '## Findings'],
  ] as const) {
    test(`the scan stops before ${label}`, () => {
      const text = `Wait.\n\nMaybe.\n\nActually no.\n\n${body}\n\nDone.`
      expect(splitLeadingDeliberation(text).visible).toStartWith(
        body.split('\n')[0]!,
      )
    })
  }

  test('"wait for the build" is not a deliberation marker', () => {
    expect(
      splitLeadingDeliberation(
        'Wait for the build to finish.\n\nThen run the tests.\n\nThen deploy.\n\nDone.',
      ).deliberation,
    ).toBe('')
  })

  test('two plain paragraphs end the scan', () => {
    expect(
      splitLeadingDeliberation(
        'Wait.\n\nMaybe.\n\nThe build is green.\n\nTests pass.\n\nShipped.',
      ).deliberation,
    ).toBe('')
  })

  test('empty input is safe', () => {
    expect(splitLeadingDeliberation('')).toEqual({ deliberation: '', visible: '' })
  })
})
