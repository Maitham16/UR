import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import {
  URBanner,
  UR_WORDMARK_ROWS,
  UR_WORDMARK_TAGLINE,
  getURWordmarkGlyphTone,
} from '../src/components/LogoV2/URBanner.js'
import { stringWidth } from '../src/ink/stringWidth.js'
import { renderToString } from '../src/utils/staticRender.js'

describe('UR welcome wordmark', () => {
  test('uses a balanced, fixed-width professional mark', () => {
    expect(UR_WORDMARK_ROWS).toHaveLength(6)
    expect(new Set(UR_WORDMARK_ROWS.map(stringWidth))).toEqual(new Set([19]))
    expect(UR_WORDMARK_ROWS.join('\n')).toContain('██████')
    expect(UR_WORDMARK_ROWS.join('\n')).toContain('██████╗')
  })

  test('keeps the brand identity explicit below the artwork', () => {
    expect(UR_WORDMARK_TAGLINE).toBe('THE AUTONOMOUS AGENT')
  })

  test('uses the same UR brand color as the house and welcome frame', () => {
    expect(getURWordmarkGlyphTone('█', 0, 0)).toBe('ur')
    expect(getURWordmarkGlyphTone('█', 4, 2)).toBe('ur')
    expect(getURWordmarkGlyphTone('╗', 0, 2)).toBe('ur')
    expect(getURWordmarkGlyphTone('═', 5, 4)).toBe('ur')
    expect(getURWordmarkGlyphTone(' ', 0, 3)).toBeUndefined()
  })

  test('renders cleanly as a centered terminal component', async () => {
    const rendered = await renderToString(<URBanner />, 80)

    expect(rendered).toContain('██╗   ██╗  ██████╗')
    expect(rendered).toContain('✦ THE AUTONOMOUS AGENT ✦')
  })
})
