import * as React from 'react'
import { Box, Text } from '../../ink.js'

const LARGE = [
  '    ╱╲    ',
  '   ╱  ╲   ',
  '  ╱    ╲  ',
  ' ╱______╲ ',
  ' │ ▣  ▣ │ ',
  ' │      │ ',
  ' │  ▢▢  │ ',
  ' └──────┘ ',
] as const

const SMALL = [
  ' ╱╲ ',
  '╱──╲',
  '│▣▣│',
  '└▢▢┘',
] as const

// A one-cell, dimmed drop shadow adds depth without changing or overwriting
// any character in the established house mark.
const LARGE_SHADOW_START_ROW = 3
export const LARGE_HOUSE_BOTTOM_SHADOW = '  ░░░░░░░░ '

export type UrHouseProps = {
  size?: 'small' | 'large'
}

export function UrHouse({ size = 'large' }: UrHouseProps): React.ReactNode {
  const rows = size === 'small' ? SMALL : LARGE
  return (
    <Box flexDirection="column" alignItems="center">
      {rows.map((row, i) => (
        <Box key={i} flexDirection="row">
          <Text color="ur">{row}</Text>
          {size === 'large' && (
            <Text color="ur" dimColor>
              {i >= LARGE_SHADOW_START_ROW ? '░' : ' '}
            </Text>
          )}
        </Box>
      ))}
      {size === 'large' && (
        <Text color="ur" dimColor>
          {LARGE_HOUSE_BOTTOM_SHADOW}
        </Text>
      )}
    </Box>
  )
}
