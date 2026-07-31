/**
 * Whether the fixed deck + rail are on screen, answerable without importing
 * any of them.
 *
 * The rail carries model, provider, mode, context usage, the edit state and
 * the update notice. The pre-existing footer carries the same six things in
 * three different places (StatusLine's default bar, TokenWarning, and the
 * permission-mode hint in PromptInputFooterLeftSide). With both rendered the
 * screen shows each value twice, which is what the redesign was meant to
 * remove — so those three suppress themselves while the rail is up.
 *
 * This module deliberately imports nothing. Its callers are React-Compiler
 * output in the prompt-input footer; pulling CommandDeckLayout in there would
 * drag ink, the palette, the metrics reader and the house artwork into the
 * footer's module graph. In this codebase a module load is not free — some
 * register commands — and that has already flipped command visibility once.
 *
 * Terminal size is read from process.stdout rather than useTerminalSize so
 * that no consumer gains a hook: adding one to compiler output shifts the
 * memo-slot sequence, and an off-by-one there yields cached JSX rendered
 * against changed props. Ink re-renders the whole tree on resize anyway.
 */

export const DECK_ROWS_FULL = 15
export const DECK_ROWS_COMPACT = 11
export const RAIL_ROWS = 3
const MIN_MIDDLE_ROWS = 6

export function fixedRowsFor(columns: number): number {
  return (columns >= 120 ? DECK_ROWS_FULL : DECK_ROWS_COMPACT) + RAIL_ROWS
}

export function hasRoomForDeck(columns: number, rows: number): boolean {
  return rows - fixedRowsFor(columns) >= MIN_MIDDLE_ROWS
}

/**
 * True when the rail is rendering, so a duplicate footer field should not.
 * False under a pipe or in a test, where stdout has no dimensions — the old
 * footer then stays as the only status surface.
 */
export function isDeckRailVisible(): boolean {
  const columns = process.stdout?.columns
  const rows = process.stdout?.rows
  if (!columns || !rows) return false
  return hasRoomForDeck(columns, rows)
}
