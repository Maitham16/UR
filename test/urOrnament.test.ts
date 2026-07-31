import { expect, test } from 'bun:test'
import {
  BORDER_CLASSIC,
  BORDER_CUNEIFORM,
  BORDER_FOCUS,
  BORDER_ROYAL,
  BORDER_STONE,
  FRIEZE,
  GATE_MARK,
  GATE_MARK_ASCII,
  MARK_INLINE,
  frieze,
  quietPanel,
  royalRule,
  type FriezeName,
} from '../src/constants/urOrnament.ts'

// A decorative band that overshoots its column budget wraps, and a wrapped
// frieze reads as corruption rather than ornament. Width correctness is the
// whole contract here — these are the pieces drawn at the exact edges of the
// screen, where an off-by-one is visible on every frame.

const NAMES = Object.keys(FRIEZE) as FriezeName[]

test('every frieze tiles to an exact width, odd or even', () => {
  // The units are two characters wide, so odd widths are the interesting case.
  for (const name of NAMES) {
    for (const width of [1, 7, 13, 39, 40, 79, 80, 159, 160]) {
      expect([...frieze(name, width)]).toHaveLength(width)
    }
  }
})

test('a zero or negative width produces nothing, not a stray character', () => {
  for (const name of NAMES) {
    expect(frieze(name, 0)).toBe('')
    expect(frieze(name, -5)).toBe('')
  }
})

test('the royal rule totals exactly its requested width', () => {
  const { left, span, right } = royalRule(50)
  expect([...(left + span + right)]).toHaveLength(50)
  expect(left).toBe('◈')
  expect(right).toBe('◈')
})

test('the royal rule degrades rather than producing a broken frame', () => {
  // Below three columns there is no room for two rosettes and a span.
  expect(royalRule(2).left).toBe('')
  expect([...royalRule(2).span]).toHaveLength(2)
})

test('a quiet panel heading fills its width exactly', () => {
  expect([...quietPanel('session', 60)]).toHaveLength(60)
  expect(quietPanel('session', 60).startsWith('SESSION ─')).toBe(true)
})

test('an over-long panel title never produces a negative-length rule', () => {
  // '─'.repeat(negative) throws, which would take down the render.
  expect(() => quietPanel('x'.repeat(80), 20)).not.toThrow()
})

test('the gate mark is rectangular', () => {
  // Ragged rows would show as a torn right edge when the mark is centred.
  const widths = new Set(GATE_MARK.map(row => [...row].length))
  expect(widths.size).toBe(1)
  expect(GATE_MARK).toHaveLength(7)
})

test('the ASCII gate matches the Unicode gate cell for cell', () => {
  // The fallback has to occupy the same space, or layouts shift when a
  // terminal without box-drawing support falls back to it.
  expect(GATE_MARK_ASCII).toHaveLength(GATE_MARK.length)
  for (const [index, row] of GATE_MARK_ASCII.entries()) {
    expect([...row]).toHaveLength([...GATE_MARK[index]!].length)
  }
})

test('the inline mark is a fragment of the gate, not a separate glyph', () => {
  // ╱╲ is the gate's roof. Identity stays coherent from splash to header row.
  expect(MARK_INLINE.startsWith('╱╲')).toBe(true)
  expect(GATE_MARK[0]).toContain('╱╲')
})

test('every border style has all eight members', () => {
  const styles = {
    classic: BORDER_CLASSIC,
    stone: BORDER_STONE,
    cuneiform: BORDER_CUNEIFORM,
    royal: BORDER_ROYAL,
    focus: BORDER_FOCUS,
  }
  for (const [name, style] of Object.entries(styles)) {
    for (const side of [
      'topLeft', 'top', 'topRight', 'left',
      'bottomLeft', 'bottom', 'bottomRight', 'right',
    ] as const) {
      expect(`${name}.${side}`).toBe(`${name}.${side}`)
      expect(style[side].length).toBeGreaterThan(0)
    }
  }
})

test('corner characters are single cells', () => {
  // A two-character corner shifts the whole top row one column right.
  for (const style of [BORDER_CLASSIC, BORDER_STONE, BORDER_CUNEIFORM, BORDER_ROYAL, BORDER_FOCUS]) {
    for (const corner of ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const) {
      expect([...style[corner]]).toHaveLength(1)
    }
  }
})
