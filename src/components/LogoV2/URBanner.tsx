import * as React from 'react'
import { Box, Text } from '../../ink.js'

/**
 * Big "UR" wordmark banner shown in the welcome screen (right pane).
 * Block-character art, themed with the "ur" color.
 */
const ROWS = [
  '█   █   ████ ',
  '█   █   █   █',
  '█   █   ████ ',
  '█   █   █  █ ',
  ' ███    █   █',
]

export function URBanner(): React.ReactNode {
  return (
    <Box flexDirection="column" alignItems="center">
      {ROWS.map((row, i) => (
        <Text key={i} color="ur" bold>
          {row}
        </Text>
      ))}
      <Text color="ur" dimColor>
        the autonomous agent
      </Text>
    </Box>
  )
}
