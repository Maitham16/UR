import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import {
  URBanner,
  UR_WORDMARK_ROWS,
  UR_WORDMARK_TAGLINE,
} from '../src/components/LogoV2/URBanner.js'
import {
  LARGE_HOUSE_BOTTOM_SHADOW,
  UrHouse,
} from '../src/components/LogoV2/UrHouse.js'
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

  test('colors every wordmark row directly with the same UR brand tone', () => {
    const banner = URBanner()
    expect(React.isValidElement(banner)).toBe(true)
    if (!React.isValidElement<{ children: React.ReactNode }>(banner)) {
      throw new Error('expected URBanner to return a React element')
    }
    const rows = React.Children.toArray(banner.props.children)
    expect(rows).toHaveLength(7)
    for (const row of rows) {
      expect(React.isValidElement(row)).toBe(true)
      if (React.isValidElement<{ color?: string }>(row)) {
        expect(row.props.color).toBe('ur')
      }
    }
  })

  test('renders cleanly as a centered terminal component', async () => {
    const rendered = await renderToString(<URBanner />, 80)

    expect(rendered).toContain('██╗   ██╗  ██████╗')
    expect(rendered).toContain('✦ THE AUTONOMOUS AGENT ✦')
  })

  test('adds a dimmed drop shadow without changing the house artwork', async () => {
    const rendered = await renderToString(<UrHouse size="large" />, 80)

    expect(rendered).toContain(' │ ▣  ▣ │ ')
    expect(rendered).toContain(' └──────┘ ')
    expect(rendered).toContain(LARGE_HOUSE_BOTTOM_SHADOW.trim())
  })
})
