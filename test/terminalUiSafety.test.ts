import { describe, expect, test } from 'bun:test'
import chalk from 'chalk'
import stripAnsi from 'strip-ansi'
import {
  getDividerParts,
  type DividerParts,
} from '../src/components/design-system/Divider.js'
import {
  getFuzzyPickerVisibleCount,
  getGlobalSearchLayout,
  getHistorySearchLayout,
  getQuickOpenLayout,
} from '../src/components/searchPickerLayout.js'
import { getFullscreenModalSize } from '../src/components/fullscreenLayoutSizing.js'
import { normalizeHighlightedCodeWidth } from '../src/components/HighlightedCode.js'
import { getPromptSuggestionRowWidth } from '../src/components/PromptInput/PromptInputFooterSuggestions.js'
import { KeyboardEvent } from '../src/ink/events/keyboard-event.js'
import {
  INITIAL_STATE,
  parseMultipleKeypresses,
} from '../src/ink/parse-keypress.js'
import { stringWidth } from '../src/ink/stringWidth.js'
import {
  Cursor,
  normalizeCursorColumns,
} from '../src/utils/Cursor.js'
import {
  calculateLayoutDimensions,
  getCondensedLogoLayout,
} from '../src/utils/logoV2Utils.js'

function dividerText(parts: DividerParts): string {
  return parts.title === undefined
    ? parts.left
    : `${parts.left} ${parts.title} ${parts.right}`
}

describe('terminal UI narrow-layout safety', () => {
  test('titled dividers truncate ANSI content to their requested width', () => {
    const parts = getDividerParts(
      12,
      '─',
      chalk.red.bold('A very long divider title'),
    )
    const rendered = dividerText(parts)

    expect(stringWidth(rendered)).toBe(12)
    expect(stripAnsi(rendered)).toContain('…')
    expect(stripAnsi(rendered)).not.toContain('\n')
  })

  test('dividers handle tiny widths and wide fill glyphs without overflow', () => {
    const tiny = dividerText(getDividerParts(2, '─', 'Ignored title'))
    const wideFill = dividerText(getDividerParts(5, '界'))

    expect(tiny).toBe('──')
    expect(stringWidth(wideFill)).toBe(5)
  })

  test('search pickers stop reserving impossible minimum widths', () => {
    expect(getQuickOpenLayout(12)).toEqual({
      previewOnRight: false,
      maxPathWidth: 4,
      previewWidth: 6,
    })

    const global = getGlobalSearchLayout(20)
    expect(global.previewOnRight).toBe(false)
    expect(global.listWidth).toBe(12)
    expect(global.maxPathWidth + global.maxTextWidth + 4).toBeLessThanOrEqual(
      global.listWidth,
    )

    const history = getHistorySearchLayout(12, 8)
    expect(history.showAge).toBe(false)
    expect(history.rowWidth).toBe(history.listWidth)
    expect(history.previewWidth).toBeGreaterThanOrEqual(1)
  })

  test('picker height can shrink to one result row', () => {
    expect(getFuzzyPickerVisibleCount(8, 11, 10, false)).toBe(1)
    expect(getFuzzyPickerVisibleCount(8, 24, 10, false)).toBe(8)
    expect(getFuzzyPickerVisibleCount(8, 18, 10, true)).toBe(7)
  })

  test('prompt suggestions keep a positive content width during tiny resizes', () => {
    expect(getPromptSuggestionRowWidth(120)).toBe(116)
    expect(getPromptSuggestionRowWidth(4)).toBe(1)
    expect(getPromptSuggestionRowWidth(-20)).toBe(1)
    expect(getPromptSuggestionRowWidth(Number.NaN)).toBe(1)
  })

  test('fullscreen modal dimensions stay valid during tiny resizes', () => {
    expect(getFullscreenModalSize(3, 2, 2)).toEqual({
      rows: 1,
      columns: 1,
      maxHeight: 1,
      borderWidth: 3,
      paddingX: 1,
    })
  })

  test('highlighted code widths never become zero or negative', () => {
    expect(normalizeHighlightedCodeWidth(-12)).toBe(1)
    expect(normalizeHighlightedCodeWidth(32.8)).toBe(32)
    expect(normalizeHighlightedCodeWidth(Number.NaN)).toBe(80)
  })

  test('startup logo switches to a narrow-safe stacked layout', () => {
    expect(getCondensedLogoLayout(30)).toEqual({
      stacked: true,
      showMark: true,
      textWidth: 30,
    })
    expect(getCondensedLogoLayout(8)).toEqual({
      stacked: true,
      showMark: false,
      textWidth: 8,
    })
    expect(calculateLayoutDimensions(3, 'compact', 20).totalWidth).toBe(1)
  })
})

describe('terminal keyboard and cursor safety', () => {
  test('cursor layout normalizes invalid and fractional column counts', () => {
    expect(normalizeCursorColumns(-5)).toBe(2)
    expect(normalizeCursorColumns(0)).toBe(2)
    expect(normalizeCursorColumns(4.9)).toBe(4)
    expect(normalizeCursorColumns(Number.NaN)).toBe(2)

    const cursor = Cursor.fromText('abcdef', -5, 3)
    expect(cursor.measuredText.columns).toBe(1)
    expect(cursor.getPosition().column).toBeLessThanOrEqual(1)
  })

  test('high-bit Meta input is decoded without mutating the stdin buffer', () => {
    const input = Buffer.from([0xe1]) // Meta+a in legacy high-bit encoding
    const [items] = parseMultipleKeypresses(INITIAL_STATE, input)

    expect([...input]).toEqual([0xe1])
    expect(items).toHaveLength(1)
    const parsed = items[0]
    expect(parsed?.kind).toBe('key')
    if (!parsed || parsed.kind !== 'key') {
      throw new Error('expected a parsed key')
    }

    expect(parsed.name).toBe('a')
    expect(parsed.meta).toBe(true)
    const event = new KeyboardEvent(parsed)
    expect(event.key).toBe('a')
    expect(event.meta).toBe(true)
  })

  test('Meta punctuation is exposed to DOM-style key handlers', () => {
    const [initialItems, state] = parseMultipleKeypresses(
      INITIAL_STATE,
      '\x1b/',
    )
    const [flushedItems] = parseMultipleKeypresses(state, null)
    const parsed = [...initialItems, ...flushedItems][0]
    expect(parsed?.kind).toBe('key')
    if (!parsed || parsed.kind !== 'key') {
      throw new Error('expected a parsed key')
    }

    const event = new KeyboardEvent(parsed)
    expect(event.key).toBe('/')
    expect(event.meta).toBe(true)
  })
})
