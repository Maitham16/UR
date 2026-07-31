import type { PaletteToken } from '../constants/urPalette.js'

/**
 * Status-bar item registry and width-aware renderer.
 *
 * The bar must occupy exactly one row at every terminal width. Truncating the
 * assembled string would cut through whatever happened to be at the boundary —
 * usually a number, since numbers cluster on the right — so items are dropped
 * whole, lowest priority first, and each item can offer a shorter form before
 * it is dropped at all.
 *
 * Priority is about what a user glances down to check mid-run:
 *   1  state, task progress, active agents   — is it working, how far along
 *   2  model, context usage                  — what is running it, how much room
 *   3  provider, effort                      — configuration, changes rarely
 *   4  workspace, branch, clock, cost, ...   — ambient, available elsewhere
 */

export type StatusZone = 'left' | 'center' | 'right'

export type StatusItem = {
  id: string
  zone: StatusZone
  /** 1 (never drop while anything shows) .. 4 (drop first). */
  priority: 1 | 2 | 3 | 4
  /**
   * Tiebreak within a priority: higher drops earlier. Explicit because the
   * obvious implicit rule — drop right-hand zones first — removes context
   * usage before execution state, and at the narrowest widths the two things
   * worth a glance are how far along the work is and how much room is left.
   */
  dropRank?: number
  /** Full form, e.g. "kimi-k2.7-code:cloud" or "3 agents". */
  full: string
  /** Shortened form, e.g. "kimi-k2.7" or "3 ag". Omit if it cannot shorten. */
  short?: string
  color: PaletteToken
  /** Hidden regardless of width. */
  hidden?: boolean
}

export type StatusBarConfig = {
  separator: string
  compactSeparator: string
  /** Below this width, prefer short forms before dropping anything. */
  compactThreshold: number
}

export const STATUS_BAR_DEFAULTS: StatusBarConfig = {
  separator: '│',
  compactSeparator: '·',
  compactThreshold: 100,
}

/** Visible width. Box-drawing and CJK aside, one cell per code point here. */
function widthOf(text: string): number {
  return [...text].length
}

type Rendered = { text: string; items: StatusItem[] }

function joinZone(
  items: StatusItem[],
  useShort: boolean,
  config: StatusBarConfig,
): string {
  return items
    .map(item => (useShort && item.short ? item.short : item.full))
    .join(` ${config.compactSeparator} `)
}

function assemble(
  items: StatusItem[],
  useShort: boolean,
  config: StatusBarConfig,
): string {
  const zones: StatusZone[] = ['left', 'center', 'right']
  const parts = zones
    .map(zone => joinZone(items.filter(i => i.zone === zone), useShort, config))
    .filter(part => part.length > 0)
  return parts.join(` ${config.separator} `)
}

/**
 * Choose the richest representation that fits.
 *
 * Order: full forms, then short forms, then drop by descending priority. Items
 * are never partially rendered — a half-written "7/1" is worse than no task
 * count at all, because it reads as a real value.
 */
export function renderStatusBar(
  allItems: StatusItem[],
  width: number,
  config: StatusBarConfig = STATUS_BAR_DEFAULTS,
): Rendered {
  const visible = allItems.filter(item => !item.hidden)
  if (visible.length === 0 || width <= 0) return { text: '', items: [] }

  const full = assemble(visible, false, config)
  if (widthOf(full) <= width && width >= config.compactThreshold) {
    return { text: full, items: visible }
  }

  const short = assemble(visible, true, config)
  if (widthOf(short) <= width) {
    return { text: short, items: visible }
  }

  // Drop lowest priority first; within a priority, drop right-most zones first
  // so the left identity survives longer than ambient right-hand detail.
  const zoneOrder: Record<StatusZone, number> = { right: 0, center: 1, left: 2 }
  const droppable = [...visible].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority
    return zoneOrder[a.zone] - zoneOrder[b.zone]
  })

  let kept = [...visible]
  for (const candidate of droppable) {
    if (widthOf(assemble(kept, true, config)) <= width) break
    if (kept.length === 1) break
    kept = kept.filter(item => item !== candidate)
  }

  return { text: assemble(kept, true, config), items: kept }
}

/**
 * Context usage colours at fixed thresholds. Anything gentler would mean the
 * bar changes colour constantly during a long session, which trains the eye to
 * ignore it — the opposite of the point.
 */
export function contextColor(percent: number): PaletteToken {
  if (percent > 90) return 'error'
  if (percent > 75) return 'warning'
  return 'textMuted'
}
