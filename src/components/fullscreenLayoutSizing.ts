export type FullscreenModalSize = {
  rows: number
  columns: number
  maxHeight: number
  borderWidth: number
  paddingX: number
}

/**
 * Modal chrome subtracts transcript peek rows and horizontal padding from
 * the terminal. Clamp the resulting dimensions so a resize to a tiny window
 * never sends negative sizes into Yoga or child text inputs.
 */
export function getFullscreenModalSize(
  terminalColumns: number,
  terminalRows: number,
  transcriptPeek: number,
): FullscreenModalSize {
  const columns = Number.isFinite(terminalColumns)
    ? Math.max(0, Math.floor(terminalColumns))
    : 0
  const rows = Number.isFinite(terminalRows)
    ? Math.max(0, Math.floor(terminalRows))
    : 0
  const peek = Number.isFinite(transcriptPeek)
    ? Math.max(0, Math.floor(transcriptPeek))
    : 0
  const paddingX = columns >= 5 ? 2 : columns >= 3 ? 1 : 0

  return {
    rows: Math.max(1, rows - peek - 1),
    columns: Math.max(1, columns - paddingX * 2),
    maxHeight: Math.max(1, rows - peek),
    borderWidth: columns,
    paddingX,
  }
}
