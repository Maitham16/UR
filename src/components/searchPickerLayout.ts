const MIN_WIDTH = 1

function safeColumns(columns: number): number {
  return Number.isFinite(columns) ? Math.max(MIN_WIDTH, Math.floor(columns)) : MIN_WIDTH
}

function available(columns: number, inset: number): number {
  return Math.max(MIN_WIDTH, safeColumns(columns) - inset)
}

export type QuickOpenLayout = {
  previewOnRight: boolean
  maxPathWidth: number
  previewWidth: number
}

export function getQuickOpenLayout(columns: number): QuickOpenLayout {
  const safe = safeColumns(columns)
  const previewOnRight = safe >= 120

  if (!previewOnRight) {
    return {
      previewOnRight,
      maxPathWidth: available(safe, 8),
      previewWidth: available(safe, 6),
    }
  }

  const maxPathWidth = Math.max(20, Math.floor((safe - 10) * 0.4))
  return {
    previewOnRight,
    maxPathWidth,
    previewWidth: Math.max(MIN_WIDTH, safe - maxPathWidth - 14),
  }
}

export type GlobalSearchLayout = {
  previewOnRight: boolean
  listWidth: number
  maxPathWidth: number
  maxTextWidth: number
  previewWidth: number
}

export function getGlobalSearchLayout(columns: number): GlobalSearchLayout {
  const safe = safeColumns(columns)
  const previewOnRight = safe >= 140
  const listWidth = previewOnRight
    ? Math.max(MIN_WIDTH, Math.floor((safe - 10) * 0.5))
    : available(safe, 8)
  const maxPathWidth = Math.max(MIN_WIDTH, Math.floor(listWidth * 0.4))

  return {
    previewOnRight,
    listWidth,
    maxPathWidth,
    maxTextWidth: Math.max(MIN_WIDTH, listWidth - maxPathWidth - 4),
    previewWidth: previewOnRight
      ? Math.max(MIN_WIDTH, safe - listWidth - 14)
      : available(safe, 6),
  }
}

export type HistorySearchLayout = {
  previewOnRight: boolean
  listWidth: number
  rowWidth: number
  previewWidth: number
  showAge: boolean
}

export function getHistorySearchLayout(
  columns: number,
  ageWidth: number,
): HistorySearchLayout {
  const safe = safeColumns(columns)
  const previewOnRight = safe >= 100
  const listWidth = previewOnRight
    ? Math.max(MIN_WIDTH, Math.floor((safe - 6) * 0.5))
    : available(safe, 6)
  // Preserve a useful amount of prompt text. A fixed 8-cell age column used
  // to consume the entire row on narrow terminals.
  const showAge = listWidth >= ageWidth + 6

  return {
    previewOnRight,
    listWidth,
    rowWidth: showAge
      ? Math.max(MIN_WIDTH, listWidth - ageWidth - 1)
      : listWidth,
    previewWidth: previewOnRight
      ? Math.max(MIN_WIDTH, safe - listWidth - 12)
      : available(safe, 10),
    showAge,
  }
}

export function getFuzzyPickerVisibleCount(
  requested: number,
  rows: number,
  chromeRows: number,
  hasMatchLabel: boolean,
): number {
  const safeRequested = Number.isFinite(requested)
    ? Math.max(1, Math.floor(requested))
    : 1
  const safeRows = Number.isFinite(rows) ? Math.max(1, Math.floor(rows)) : 1
  const availableRows = Math.max(
    1,
    safeRows - chromeRows - (hasMatchLabel ? 1 : 0),
  )
  return Math.min(safeRequested, availableRows)
}
