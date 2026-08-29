import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { isScreenReaderMode } from '../../utils/screenReader.js'

export const UR_WORDMARK_ROWS = [
  '██╗   ██╗  ██████╗ ',
  '██║   ██║  ██╔══██╗',
  '██║   ██║  ██████╔╝',
  '██║   ██║  ██╔══██╗',
  '╚██████╔╝  ██║  ██║',
  ' ╚═════╝   ╚═╝  ╚═╝',
] as const

export const COMPACT_UR_WORDMARK_ROWS = UR_WORDMARK_ROWS

export const UR_WORDMARK_TAGLINE = 'THE AUTONOMOUS AGENT'

export type URWordmarkVariant = 'compact' | 'minimal'

export function getResponsiveURWordmarkVariant(
  availableWidth = Number.POSITIVE_INFINITY,
  availableHeight = Number.POSITIVE_INFINITY,
): URWordmarkVariant {
  if (availableWidth >= 20 && availableHeight >= 8) return 'compact'
  return 'minimal'
}

export type URBannerProps = {
  availableWidth?: number
  availableHeight?: number
}

export function URBanner({
  availableWidth,
  availableHeight,
}: URBannerProps = {}): React.ReactNode {
  if (isScreenReaderMode()) {
    return <Text>UR — the autonomous agent</Text>
  }

  const variant = getResponsiveURWordmarkVariant(
    availableWidth,
    availableHeight,
  )
  const rows =
    variant === 'compact' ? UR_WORDMARK_ROWS : (['UR'] as const)
  const showTagline = variant !== 'minimal'
  const decorateTagline = (availableWidth ?? Number.POSITIVE_INFINITY) >= 24

  return (
    <Box flexDirection="column" alignItems="center">
      {rows.map((row, i) => (
        <Text key={i} color="ur">
          {row}
        </Text>
      ))}
      {showTagline && (
        <Text color="ur">
          {decorateTagline
            ? `✦ ${UR_WORDMARK_TAGLINE} ✦`
            : UR_WORDMARK_TAGLINE}
        </Text>
      )}
    </Box>
  )
}
