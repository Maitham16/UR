import type { DeckColor, DeckWidthMode } from './palette.js'

/**
 * Status rail item registry.
 *
 * The rail must never wrap. Rather than truncating a finished line, each item
 * declares three renderings and two widths, and the layout drops or degrades
 * items by priority until the row fits. Dropping the least important item
 * whole reads better than clipping the most important one mid-word.
 */

export type DeckAlignment = 'left' | 'center' | 'right'

export type StatusContext = {
  model: string
  provider: string
  mode: string
  effort: string | null
  contextPercent: number | null
  editsEnabled: boolean
  updateVersion: string | null
  shortcutHint: string | null
}

export type StatusItem = {
  id: string
  /** Higher survives longer when width runs out. */
  priority: number
  preferredWidth: number
  minimumWidth: number
  alignment: DeckAlignment
  /** Hidden entirely when this returns false, before any width maths. */
  isVisible: (context: StatusContext) => boolean
  fullRenderer: (context: StatusContext) => string
  compactRenderer: (context: StatusContext) => string
  minimalRenderer: (context: StatusContext) => string
  /** Role from the palette; the renderer decides the shade. */
  color: DeckColor
  /** Rendered with a raised background and bold weight. */
  emphasis?: boolean
}

const pct = (value: number | null): string =>
  value === null ? '' : `${Math.round(value)}%`

export const DEFAULT_STATUS_ITEMS: StatusItem[] = [
  {
    id: 'model',
    priority: 90,
    preferredWidth: 16,
    minimumWidth: 7,
    alignment: 'left',
    isVisible: c => c.model.length > 0,
    fullRenderer: c => c.model,
    // Drop the ":cloud" / ":4b" qualifier before dropping the name.
    compactRenderer: c => c.model.split(':')[0] ?? c.model,
    minimalRenderer: () => '',
    color: 'text',
  },
  {
    id: 'provider',
    priority: 40,
    preferredWidth: 10,
    minimumWidth: 6,
    alignment: 'left',
    isVisible: c => c.provider.length > 0,
    fullRenderer: c => c.provider,
    compactRenderer: () => '',
    minimalRenderer: () => '',
    color: 'textSecondary',
  },
  {
    id: 'mode',
    priority: 100,
    preferredWidth: 18,
    minimumWidth: 7,
    alignment: 'center',
    isVisible: c => c.mode.length > 0,
    fullRenderer: c => c.mode.toUpperCase(),
    // "ACCEPT EDITS" -> "EDITS": keep the distinguishing word, drop the verb.
    compactRenderer: c => c.mode.toUpperCase().split(' ').at(-1) ?? c.mode,
    minimalRenderer: c => c.mode.toUpperCase().split(' ').at(-1) ?? c.mode,
    color: 'focus',
    emphasis: true,
  },
  {
    id: 'effort',
    priority: 50,
    preferredWidth: 6,
    minimumWidth: 4,
    alignment: 'right',
    isVisible: c => c.effort !== null,
    fullRenderer: c => c.effort ?? '',
    compactRenderer: () => '',
    minimalRenderer: () => '',
    color: 'textSecondary',
  },
  {
    id: 'context',
    priority: 95,
    preferredWidth: 8,
    minimumWidth: 7,
    alignment: 'right',
    isVisible: c => c.contextPercent !== null,
    fullRenderer: c => `CTX ${pct(c.contextPercent)}`,
    compactRenderer: c => `CTX ${pct(c.contextPercent)}`,
    minimalRenderer: c => `CTX ${pct(c.contextPercent)}`,
    // Blue at rest, warning as it fills: the number matters most when high.
    color: 'accent',
  },
]

export const DEFAULT_SECOND_ROW_ITEMS: StatusItem[] = [
  {
    id: 'editState',
    priority: 80,
    preferredWidth: 16,
    minimumWidth: 8,
    alignment: 'left',
    isVisible: () => true,
    fullRenderer: c => (c.editsEnabled ? '▸ edits enabled' : '▪ edits paused'),
    compactRenderer: c => (c.editsEnabled ? '▸ edits' : '▪ paused'),
    minimalRenderer: () => '',
    color: 'textSecondary',
  },
  {
    id: 'shortcut',
    priority: 20,
    preferredWidth: 22,
    minimumWidth: 10,
    alignment: 'left',
    isVisible: c => c.shortcutHint !== null,
    fullRenderer: c => c.shortcutHint ?? '',
    compactRenderer: () => '',
    minimalRenderer: () => '',
    color: 'muted',
  },
  {
    id: 'update',
    priority: 60,
    preferredWidth: 18,
    minimumWidth: 8,
    alignment: 'right',
    isVisible: c => c.updateVersion !== null,
    fullRenderer: c => `update ${c.updateVersion}`,
    compactRenderer: c => `↑${c.updateVersion}`,
    minimalRenderer: () => '',
    color: 'warning',
  },
]

export type RenderedStatusItem = {
  id: string
  text: string
  alignment: DeckAlignment
  color: DeckColor
  emphasis: boolean
}

/**
 * Choose renderings that fit `columns` without wrapping.
 *
 * Degrade before dropping: an item at compact width still carries meaning,
 * while a missing item carries none. Only when every remaining item is already
 * minimal does the lowest-priority one get removed.
 */
export function layoutStatusRow(
  items: StatusItem[],
  context: StatusContext,
  columns: number,
  mode: DeckWidthMode,
  separatorWidth = 3,
): RenderedStatusItem[] {
  const visible = items.filter(item => item.isVisible(context))

  const renderAt = (item: StatusItem, at: DeckWidthMode): string =>
    at === 'full'
      ? item.fullRenderer(context)
      : at === 'compact'
        ? item.compactRenderer(context)
        : item.minimalRenderer(context)

  const build = (at: DeckWidthMode, pool: StatusItem[]): RenderedStatusItem[] =>
    pool
      .map(item => ({
        id: item.id,
        text: renderAt(item, at),
        alignment: item.alignment,
        color: item.color,
        emphasis: item.emphasis === true,
      }))
      .filter(rendered => rendered.text.length > 0)

  const widthOf = (rendered: RenderedStatusItem[]): number =>
    rendered.reduce((sum, r) => sum + r.text.length, 0) +
    Math.max(0, rendered.length - 1) * separatorWidth

  // Never render wider than the caller's own mode, so a narrow terminal does
  // not get the full row just because it happens to fit.
  const ladder: DeckWidthMode[] =
    mode === 'full'
      ? ['full', 'compact', 'minimal']
      : mode === 'compact'
        ? ['compact', 'minimal']
        : ['minimal']

  for (const at of ladder) {
    const rendered = build(at, visible)
    if (widthOf(rendered) <= columns) return rendered
  }

  // Still too wide at the narrowest rendering: drop by ascending priority.
  const pool = [...visible].sort((a, b) => a.priority - b.priority)
  while (pool.length > 0) {
    pool.shift()
    const rendered = build('minimal', pool)
    if (widthOf(rendered) <= columns) return rendered
  }
  return []
}
