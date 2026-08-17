import * as React from 'react'
import { Box, Text } from '../../ink.js'

export const LARGE_HOUSE_ROWS = [
  '    ╱╲    ',
  '   ╱  ╲   ',
  '  ╱    ╲  ',
  ' ╱______╲ ',
  ' │ ▣  ▣ │ ',
  ' │      │ ',
  ' │  ▢▢  │ ',
  ' └──────┘ ',
] as const

export const SMALL_HOUSE_ROWS = [
  ' ╱╲ ',
  '╱──╲',
  '│▣▣│',
  '└▢▢┘',
] as const

export type UrHouseProps = {
  size?: 'small' | 'large'
}

export const AUTOMATIC_HOUSE_SIZE = 'large' as const

export function UrHouse({ size = 'large' }: UrHouseProps): React.ReactNode {
  const rows = size === 'small' ? SMALL_HOUSE_ROWS : LARGE_HOUSE_ROWS
  return (
    <Box flexDirection="column" alignItems="center">
      {rows.map((row, index) => (
        <Text key={index} color="ur">
          {row}
        </Text>
      ))}
    </Box>
  )
}
