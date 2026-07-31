/**
 * Sizing for the AskUserQuestion choice list.
 *
 * The select components window their options at a default of 5. A question
 * with five or more choices therefore rendered a scrolling window whose tail
 * sat below the footer divider, so the later choices read as a detached
 * second group. Questions are short lists that the user must compare at a
 * glance, so they are shown as one continuous list and only fall back to
 * windowing when the terminal genuinely cannot fit them.
 */

/** Rows consumed by the question chrome: nav bar, divider, footer, hint line. */
export const CHOICE_LIST_CHROME_ROWS = 9

/** Never window below this many rows, even in a very short terminal. */
export const MIN_VISIBLE_CHOICES = 3

/** Conventional terminal height used when the real one is unknown. */
const FALLBACK_TERMINAL_ROWS = 24

/**
 * How many choices to render without windowing.
 *
 * @param optionCount total entries in the list, including the trailing "Other"
 * @param terminalRows current terminal height, when known
 * @param descriptionRows extra rows each entry needs (a description line)
 */
export function visibleChoiceCount(
  optionCount: number,
  terminalRows: number | undefined,
  descriptionRows = 1,
): number {
  if (!Number.isFinite(optionCount) || optionCount <= 0) {
    return MIN_VISIBLE_CHOICES
  }
  const total = Math.floor(optionCount)
  const rows =
    Number.isFinite(terminalRows) && (terminalRows as number) > 0
      ? Math.floor(terminalRows as number)
      : FALLBACK_TERMINAL_ROWS
  const rowsPerOption = Math.max(1, Math.floor(descriptionRows) + 1)
  const budget = Math.floor((rows - CHOICE_LIST_CHROME_ROWS) / rowsPerOption)
  if (budget >= total) {
    // Everything fits: one continuous list, no window, no scroll indicator.
    return total
  }
  return Math.max(MIN_VISIBLE_CHOICES, Math.min(total, budget))
}
