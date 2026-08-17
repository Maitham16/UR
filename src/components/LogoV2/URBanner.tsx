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

export function URBanner(): React.ReactNode {
  if (isScreenReaderMode()) {
    return <Text>UR — the autonomous agent</Text>
  }

  return (
    <Box flexDirection="column" alignItems="center">
      {UR_WORDMARK_ROWS.map((row, i) => (
        <Text key={i} color="ur">
          {row}
        </Text>
      ))}
      <Text color="ur">
        ✦ {UR_WORDMARK_TAGLINE} ✦
      </Text>
    </Box>
  )
}
