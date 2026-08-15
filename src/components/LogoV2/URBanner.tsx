import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { isScreenReaderMode } from '../../utils/screenReader.js'

/**
 * Big "UR" wordmark banner shown in the welcome screen (right pane).
 * The outlined terminals keep the mark recognizable at a glance while the
 * solid stems retain the visual weight of the original block logo.
 */
export const UR_WORDMARK_ROWS = [
  '██╗   ██╗  ██████╗ ',
  '██║   ██║  ██╔══██╗',
  '██║   ██║  ██████╔╝',
  '██║   ██║  ██╔══██╗',
  '╚██████╔╝  ██║  ██║',
  ' ╚═════╝   ╚═╝  ╚═╝',
] as const

export const UR_WORDMARK_TAGLINE = 'THE AUTONOMOUS AGENT'

type WordmarkTone = 'ur' | 'urShimmer' | 'warningShimmer' | undefined

// A small top-left specular pass gives the solid faces a polished highlight
// without relying on animation, gradients, or terminal-specific transparency.
const SPECULAR_GLYPHS = new Set([
  '0:0',
  '0:1',
  '0:6',
  '0:7',
  '0:11',
  '0:12',
  '0:13',
  '0:14',
  '0:15',
  '0:16',
  '1:0',
  '1:6',
  '1:11',
  '1:15',
  '2:0',
  '2:6',
  '2:11',
])

export function getURWordmarkGlyphTone(
  glyph: string,
  row: number,
  column: number,
): WordmarkTone {
  if (glyph === '█') {
    return SPECULAR_GLYPHS.has(`${row}:${column}`)
      ? 'warningShimmer'
      : 'urShimmer'
  }
  if ('╗║╔╝╚═'.includes(glyph)) return 'ur'
  return undefined
}

export function URBanner(): React.ReactNode {
  if (isScreenReaderMode()) {
    return <Text>UR — the autonomous agent</Text>
  }

  return (
    <Box flexDirection="column" alignItems="center">
      {UR_WORDMARK_ROWS.map((row, i) => (
        <Text key={i} bold>
          {[...row].map((glyph, column) => (
            <Text
              key={`${i}:${column}`}
              color={getURWordmarkGlyphTone(glyph, i, column)}
            >
              {glyph}
            </Text>
          ))}
        </Text>
      ))}
      <Text bold>
        <Text color="warningShimmer">✦</Text>
        <Text color="urShimmer"> {UR_WORDMARK_TAGLINE} </Text>
        <Text color="warningShimmer">✦</Text>
      </Text>
    </Box>
  )
}
