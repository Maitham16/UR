import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import {
  COMPACT_UR_WORDMARK_ROWS,
  getResponsiveURWordmarkVariant,
  URBanner,
  UR_WORDMARK_ROWS,
  UR_WORDMARK_TAGLINE,
} from '../src/components/LogoV2/URBanner.js'
import {
  AUTOMATIC_HOUSE_SIZE,
  LARGE_HOUSE_ROWS,
  UrHouse,
} from '../src/components/LogoV2/UrHouse.js'
import { stringWidth } from '../src/ink/stringWidth.js'
import { renderToString } from '../src/utils/staticRender.js'

describe('UR welcome wordmark', () => {
  test('uses a balanced, fixed-width professional mark', () => {
    expect(UR_WORDMARK_ROWS).toHaveLength(6)
    expect(new Set(UR_WORDMARK_ROWS.map(stringWidth))).toEqual(new Set([19]))
    expect(UR_WORDMARK_ROWS[0]).toBe('██╗   ██╗  ██████╗ ')
    expect(UR_WORDMARK_ROWS.at(-1)).toBe(' ╚═════╝   ╚═╝  ╚═╝')
  })

  test('adapts the wordmark to terminal width and height', () => {
    expect(getResponsiveURWordmarkVariant(80, 30)).toBe('compact')
    expect(getResponsiveURWordmarkVariant(41, 22)).toBe('compact')
    expect(getResponsiveURWordmarkVariant(40, 22)).toBe('compact')
    expect(getResponsiveURWordmarkVariant(80, 12)).toBe('compact')
    expect(getResponsiveURWordmarkVariant(19, 30)).toBe('minimal')
    expect(getResponsiveURWordmarkVariant(80, 7)).toBe('minimal')
    expect(new Set(COMPACT_UR_WORDMARK_ROWS.map(stringWidth))).toEqual(
      new Set([19]),
    )
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

  test('renders compact and minimal fallbacks without overflowing', async () => {
    const compact = await renderToString(
      <URBanner availableWidth={20} availableHeight={12} />,
      20,
    )
    const minimal = await renderToString(
      <URBanner availableWidth={10} availableHeight={5} />,
      10,
    )

    expect(compact).toContain('██╗   ██╗  ██████╗')
    expect(compact).toContain(UR_WORDMARK_TAGLINE)
    expect(compact).not.toContain('✦')
    expect(Math.max(...compact.split('\n').map(stringWidth))).toBeLessThanOrEqual(
      20,
    )
    expect(minimal.trim()).toBe('UR')
    expect(Math.max(...minimal.split('\n').map(stringWidth))).toBeLessThanOrEqual(
      10,
    )
  })

  test('renders the original house cleanly without a shadow', async () => {
    const rendered = await renderToString(<UrHouse size="large" />, 80)
    const small = await renderToString(<UrHouse size="small" />, 80)

    expect(LARGE_HOUSE_ROWS).toContain(' │ ▣  ▣ │ ')
    expect(rendered).toContain('│ ▣  ▣ │')
    expect(rendered).toContain('└──────┘')
    expect(rendered).not.toContain('░')
    expect(small).not.toContain('░')
  })

  test('uses the large house for automatic layouts', () => {
    expect(AUTOMATIC_HOUSE_SIZE).toBe('large')
  })
})
