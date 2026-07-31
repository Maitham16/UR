import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { UrHouse } from '../LogoV2/UrHouse.js'
import { DECK_PALETTE, deckWidthMode } from './palette.js'
import { type Metric, metricLine } from './metrics.js'

/**
 * Fixed top region: the UR Command Deck.
 *
 * Three balanced columns instead of the previous full-width bordered banner.
 * The old layout spent most of its width on an empty right region and drew a
 * bright border around the whole thing, which made the frame louder than the
 * content inside it. Here the only rule drawn is one graphite separator under
 * the header, and the width goes to information.
 *
 * The house artwork is rendered by importing UrHouse unchanged — it is not
 * re-drawn here, so it stays character-for-character identical.
 */

export type CommandDeckProps = {
  columns: number
  version: string
  workspaceBasename: string
  branch: string | null
  clock: string
  model: string
  repository: string
  workspacePath: string
  sessionTime: string
  metrics: Metric[]
}

const GUTTER = 2

/**
 * Column widths. The centre holds the wordmark, so it gets the largest share;
 * the right column is sized to its own content rather than to the leftover,
 * which is what produced the oversized empty region before.
 */
export function deckColumnWidths(columns: number): {
  left: number
  center: number
  right: number
} {
  const usable = Math.max(0, columns - GUTTER * 2)
  const right = Math.min(22, Math.max(12, Math.floor(usable * 0.22)))
  const left = Math.min(30, Math.max(14, Math.floor(usable * 0.3)))
  return { left, center: Math.max(0, usable - left - right), right }
}

function Separator({ width }: { width: number }): React.ReactNode {
  return (
    <Text color={DECK_PALETTE.border}>{'─'.repeat(Math.max(0, width))}</Text>
  )
}

function Field({
  label,
  value,
  labelWidth = 8,
}: {
  label: string
  value: string
  labelWidth?: number
}): React.ReactNode {
  return (
    <Text>
      <Text color={DECK_PALETTE.muted}>{label.padEnd(labelWidth)}</Text>
      <Text color={DECK_PALETTE.text}>{value}</Text>
    </Text>
  )
}

export function CommandDeck({
  columns,
  version,
  workspaceBasename,
  branch,
  clock,
  model,
  repository,
  workspacePath,
  sessionTime,
  metrics,
}: CommandDeckProps): React.ReactNode {
  const mode = deckWidthMode(columns)
  const { left, center, right } = deckColumnWidths(columns)

  return (
    <Box flexDirection="column" flexShrink={0} paddingX={1}>
      {/* Header: identity, location, time */}
      <Box>
        <Box width={left}>
          <Text>
            <Text color={DECK_PALETTE.brand} bold>
              ◆ UR NEXUS
            </Text>
            <Text color={DECK_PALETTE.muted}>{`  ${version}`}</Text>
          </Text>
        </Box>
        <Box width={center} justifyContent="center">
          <Text>
            <Text color={DECK_PALETTE.textSecondary}>{workspaceBasename}</Text>
            {branch ? (
              <Text color={DECK_PALETTE.muted}>{`  ${branch}`}</Text>
            ) : null}
          </Text>
        </Box>
        <Box width={right} justifyContent="flex-end">
          <Text color={DECK_PALETTE.muted}>{clock}</Text>
        </Box>
      </Box>

      <Separator width={Math.max(0, columns - GUTTER)} />

      {/* Body: identity block, wordmark, metrics */}
      <Box>
        <Box width={left} flexDirection="column">
          <UrHouse size={mode === 'full' ? 'large' : 'small'} />
          <Text color={DECK_PALETTE.text}>Welcome back</Text>
          <Field label="model" value={model} />
          <Field label="repo" value={repository} />
          <Text color={DECK_PALETTE.muted}>{workspacePath}</Text>
        </Box>

        <Box width={center} flexDirection="column" alignItems="center">
          <URWordmark />
          <Text color={DECK_PALETTE.muted}>the autonomous agent</Text>
          <Box flexDirection="column" marginTop={1}>
            <Field label="SESSION" value={sessionTime} labelWidth={9} />
            <Field label="WS" value={workspaceBasename} labelWidth={9} />
            <Field label="REPO" value={repository} labelWidth={9} />
            <Field label="BRANCH" value={branch ?? '—'} labelWidth={9} />
          </Box>
        </Box>

        <Box width={right} flexDirection="column">
          {metrics.map(metric => {
            const line = metricLine(metric, right)
            return (
              <Text key={metric.label}>
                <Text color={DECK_PALETTE.muted}>{line.label}</Text>
                {line.bar ? (
                  <Text color={DECK_PALETTE[line.barColor]}>{`${line.bar} `}</Text>
                ) : null}
                <Text color={DECK_PALETTE[line.color]}>{line.value}</Text>
              </Text>
            )
          })}
        </Box>
      </Box>
    </Box>
  )
}

/**
 * The UR wordmark, kept but no longer dominant: rendered in brand bronze at
 * normal weight rather than as the bright full-width headline it was.
 */
const WORDMARK_ROWS = [
  '█   █   ████ ',
  '█   █   █   █',
  '█   █   ████ ',
  '█   █   █  █ ',
  ' ███    █   █',
]

function URWordmark(): React.ReactNode {
  return (
    <Box flexDirection="column" alignItems="center">
      {WORDMARK_ROWS.map((row, index) => (
        <Text key={index} color={DECK_PALETTE.brand}>
          {row}
        </Text>
      ))}
    </Box>
  )
}
