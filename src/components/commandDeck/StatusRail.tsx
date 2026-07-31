import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { DECK_PALETTE, deckWidthMode } from './palette.js'
import {
  DEFAULT_SECOND_ROW_ITEMS,
  DEFAULT_STATUS_ITEMS,
  layoutStatusRow,
  type RenderedStatusItem,
  type StatusContext,
  type StatusItem,
} from './statusItems.js'

/**
 * Fixed bottom region: a two-row information rail.
 *
 * No surrounding box — one quiet separator above it and then content, so the
 * footer reads as part of the terminal rather than as a widget sitting in it.
 * Both rows are laid out to fit the available width before rendering, so the
 * rail never wraps; see layoutStatusRow for how items degrade and drop.
 */

export type StatusRailProps = {
  columns: number
  context: StatusContext
  /** Override to reorder, hide, or re-place items. */
  items?: StatusItem[]
  secondRowItems?: StatusItem[]
}

function group(
  rendered: RenderedStatusItem[],
  alignment: RenderedStatusItem['alignment'],
): RenderedStatusItem[] {
  return rendered.filter(item => item.alignment === alignment)
}

function Cell({ item }: { item: RenderedStatusItem }): React.ReactNode {
  if (item.emphasis) {
    // Raised background rather than brackets: brackets survive everywhere but
    // read as punctuation, and the spec asks for them only as the fallback.
    return (
      <Text
        color={DECK_PALETTE.focus}
        backgroundColor={DECK_PALETTE.surfaceSecondary}
        bold
      >
        {` ${item.text} `}
      </Text>
    )
  }
  return <Text color={DECK_PALETTE[item.color]}>{item.text}</Text>
}

function Row({
  rendered,
  columns,
}: {
  rendered: RenderedStatusItem[]
  columns: number
}): React.ReactNode {
  const left = group(rendered, 'left')
  const center = group(rendered, 'center')
  const right = group(rendered, 'right')
  const side = Math.floor(columns / 3)

  const join = (items: RenderedStatusItem[]): React.ReactNode[] =>
    items.map((item, index) => (
      <React.Fragment key={item.id}>
        {index > 0 ? <Text color={DECK_PALETTE.muted}>{'   '}</Text> : null}
        <Cell item={item} />
      </React.Fragment>
    ))

  return (
    <Box>
      <Box width={side}>{join(left)}</Box>
      <Box width={columns - side * 2} justifyContent="center">
        {join(center)}
      </Box>
      <Box width={side} justifyContent="flex-end">
        {join(right)}
      </Box>
    </Box>
  )
}

export function StatusRail({
  columns,
  context,
  items = DEFAULT_STATUS_ITEMS,
  secondRowItems = DEFAULT_SECOND_ROW_ITEMS,
}: StatusRailProps): React.ReactNode {
  const mode = deckWidthMode(columns)
  const firstRow = layoutStatusRow(items, context, columns, mode)
  const secondRow = layoutStatusRow(secondRowItems, context, columns, mode)

  return (
    <Box flexDirection="column" flexShrink={0} paddingX={1}>
      <Text color={DECK_PALETTE.border}>
        {'─'.repeat(Math.max(0, columns - 2))}
      </Text>
      <Row rendered={firstRow} columns={Math.max(0, columns - 2)} />
      {secondRow.length > 0 ? (
        <Row rendered={secondRow} columns={Math.max(0, columns - 2)} />
      ) : null}
    </Box>
  )
}
