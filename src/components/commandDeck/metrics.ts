import { DECK_PALETTE, type DeckColor } from './palette.js'

/**
 * Vertical system metrics for the deck's right column.
 *
 * Fixed-width labels and right-aligned values, so the column does not shift
 * horizontally when 9% becomes 71%. A metric readout that jitters as numbers
 * change is worse than one that is slightly wider than it needs to be.
 */

export type Metric = {
  label: string
  /** 0..100, or null when the value is genuinely unknown. */
  percent: number | null
}

const LABEL_WIDTH = 6
const VALUE_WIDTH = 4

/**
 * Colour by level, not by metric. A metric is green while healthy, amber as it
 * fills and red when nearly exhausted — the same reading regardless of whether
 * it is CPU or context, so the user learns one rule.
 */
export function metricColor(percent: number | null): DeckColor {
  if (percent === null) return 'muted'
  if (percent >= 90) return 'error'
  if (percent >= 75) return 'warning'
  return 'accent'
}

export function formatMetricValue(percent: number | null): string {
  const text = percent === null ? '--' : `${Math.round(percent)}%`
  return text.padStart(VALUE_WIDTH)
}

export function formatMetricLabel(label: string): string {
  return label.padEnd(LABEL_WIDTH)
}

/**
 * Miniature bar, drawn only when the column has room for it. Below that the
 * label and value alone still carry the whole reading, so the bar is the first
 * thing to go rather than the last.
 */
export function renderMetricBar(
  percent: number | null,
  width: number,
): string {
  if (width <= 0) return ''
  if (percent === null) return '─'.repeat(width)
  const clamped = Math.max(0, Math.min(100, percent))
  const filled = Math.round((clamped / 100) * width)
  return '━'.repeat(filled) + '─'.repeat(Math.max(0, width - filled))
}

/** Width needed for label + value with one space between. */
export const METRIC_MIN_WIDTH = LABEL_WIDTH + VALUE_WIDTH
/** Below this the bar is dropped and only label + value are drawn. */
export const METRIC_BAR_MIN_WIDTH = METRIC_MIN_WIDTH + 10

export function metricLine(
  metric: Metric,
  columnWidth: number,
): { label: string; bar: string; value: string; color: DeckColor } {
  const barWidth =
    columnWidth >= METRIC_BAR_MIN_WIDTH
      ? Math.min(9, columnWidth - METRIC_MIN_WIDTH - 1)
      : 0
  return {
    label: formatMetricLabel(metric.label),
    bar: renderMetricBar(metric.percent, barWidth),
    value: formatMetricValue(metric.percent),
    color: metricColor(metric.percent),
  }
}

export const DECK_PALETTE_REF = DECK_PALETTE
