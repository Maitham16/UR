import * as React from 'react'
import { Box } from '../../ink.js'
import { CommandDeck, type CommandDeckProps } from './CommandDeck.js'
import { StatusRail, type StatusRailProps } from './StatusRail.js'

/**
 * The fixed/scroll/fixed shell.
 *
 * REPL already renders inside AlternateScreen's `<Box height={rows}>`, and
 * FullscreenLayout's ScrollBox already grows into it — so this does not
 * introduce a new scrolling model, it just places the deck and rail either
 * side of the region that already scrolls.
 *
 * Both fixed regions are flexShrink={0}: without it, Ink shrinks them to fit
 * when the middle content is tall, and the deck loses rows silently rather
 * than the middle scrolling. The middle is flexGrow={1} with overflow hidden
 * so its overflow is clipped by the container instead of pushing the rail off
 * the bottom of the screen.
 */

export type CommandDeckLayoutProps = {
  rows: number
  deck: CommandDeckProps
  rail: StatusRailProps
  children: React.ReactNode
}

export function CommandDeckLayout({
  rows,
  deck,
  rail,
  children,
}: CommandDeckLayoutProps): React.ReactNode {
  return (
    <Box flexDirection="column" height={rows}>
      <Box flexShrink={0} flexDirection="column">
        <CommandDeck {...deck} />
      </Box>
      <Box flexGrow={1} flexDirection="column" overflow="hidden">
        {children}
      </Box>
      <Box flexShrink={0} flexDirection="column">
        <StatusRail {...rail} />
      </Box>
    </Box>
  )
}

/**
 * Rows the fixed regions occupy, so a caller can tell whether the terminal is
 * tall enough before committing to the layout.
 *
 * Deck: header + separator + the tallest column (large house is 8 rows plus
 * four fields; centre is 5 wordmark rows, tagline, blank, four fields).
 * Rail: separator + two rows.
 */
// Re-exported from deckVisibility, which the prompt-input footer also reads to
// decide whether to suppress its duplicate fields. One definition: if the
// budget here and the predicate there ever disagreed, a terminal size would
// exist that shows both status surfaces or neither.
export {
  DECK_ROWS_COMPACT,
  DECK_ROWS_FULL,
  RAIL_ROWS,
  fixedRowsFor,
  hasRoomForDeck,
} from './deckVisibility.js'
