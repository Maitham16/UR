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

type WordmarkTone = 'ur' | undefined

export function getURWordmarkGlyphTone(
  glyph: string,
  _row: number,
  _column: number,
): WordmarkTone {
  return glyph === ' ' ? undefined : 'ur'
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
        <Text color="ur">✦ {UR_WORDMARK_TAGLINE} ✦</Text>
      </Text>
    </Box>
  )
}
