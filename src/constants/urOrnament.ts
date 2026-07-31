/**
 * UR Nexus ornament set — friezes, border styles, and the brand mark.
 *
 * Everything here is plain Unicode box-drawing and geometric shapes. No image
 * protocol, no terminal-specific escape sequence: the identity has to survive
 * on macOS Terminal, GNOME Terminal, Konsole, Alacritty, foot and over SSH,
 * not only on terminals with graphics support.
 *
 * The vocabulary is thin strokes, not solid blocks. The design this implements
 * is fine gold line-work; heavy block glyphs (▟▙██) read as chunky sprites
 * against it and were tried first and discarded.
 */

/** Repeating band patterns. Each tiles cleanly at any width. */
export const FRIEZE = {
  /** Cylinder-seal rhythm. The strongest identity signal; splash and footer. */
  seal: '╫╪',
  /** Woven band. Lighter — the default rule under the header in working views. */
  woven: '┼─',
  /** Chevron. Use sparingly; busy at width. */
  chevron: '╱╲',
  /** Stepped. Ziggurat profile as a rule. */
  stepped: '▝▘',
  /** Plain. The quiet default anywhere a rule is only structural. */
  plain: '─',
} as const

export type FriezeName = keyof typeof FRIEZE

/**
 * Tile a frieze to an exact width.
 *
 * Truncates rather than padding, so a band never overshoots its column budget
 * and wraps — a wrapped frieze reads as corruption, not decoration.
 */
export function frieze(name: FriezeName, width: number): string {
  if (width <= 0) return ''
  const unit = FRIEZE[name]
  const repeats = Math.ceil(width / unit.length)
  return unit.repeat(repeats).slice(0, width)
}

/**
 * Royal rule: rosette, span, rosette. Returns the three parts so the caller can
 * colour the rosettes (electrum) differently from the span (border).
 */
export function royalRule(width: number): {
  left: string
  span: string
  right: string
} {
  if (width < 3) return { left: '', span: '─'.repeat(Math.max(0, width)), right: '' }
  return { left: '◈', span: '┄'.repeat(width - 2), right: '◈' }
}

/**
 * A quiet panel heading: `SESSION ─────────`. The default container in this
 * design — full boxes are reserved for focus, and drawing every section as a
 * box is what made the previous layout read as a web dashboard.
 */
export function quietPanel(title: string, width: number): string {
  const label = title.toUpperCase()
  const ruleWidth = Math.max(0, width - label.length - 1)
  return `${label} ${'─'.repeat(ruleWidth)}`
}

/** Custom BoxStyle shapes for Ink's `borderStyle`. */
export type UrBoxStyle = {
  topLeft: string
  top: string
  topRight: string
  left: string
  bottomLeft: string
  bottom: string
  bottomRight: string
  right: string
}

/** Plain single line. General containers. */
export const BORDER_CLASSIC: UrBoxStyle = {
  topLeft: '┌', top: '─', topRight: '┐',
  left: '│', right: '│',
  bottomLeft: '└', bottom: '─', bottomRight: '┘',
}

/** Coursed masonry. Long horizontal containers where a plain rule reads flat. */
export const BORDER_STONE: UrBoxStyle = {
  topLeft: '┌', top: '─┬', topRight: '┐',
  left: '│', right: '│',
  bottomLeft: '└', bottom: '─┴', bottomRight: '┘',
}

/** Seal frieze as an edge. Splash and major overlays only — busy at length. */
export const BORDER_CUNEIFORM: UrBoxStyle = {
  topLeft: '┌', top: '╫╪', topRight: '┐',
  left: '│', right: '│',
  bottomLeft: '└', bottom: '╫╪', bottomRight: '┘',
}

/** Rosette corners. Reserved for the highest-status container on a screen. */
export const BORDER_ROYAL: UrBoxStyle = {
  topLeft: '◈', top: '┄', topRight: '◈',
  left: '┆', right: '┆',
  bottomLeft: '◈', bottom: '┄', bottomRight: '◈',
}

/** Rounded, lapis-coloured by the caller. The focused input surface. */
export const BORDER_FOCUS: UrBoxStyle = {
  topLeft: '╭', top: '─', topRight: '╮',
  left: '│', right: '│',
  bottomLeft: '╰', bottom: '─', bottomRight: '╯',
}

/**
 * The gate mark: ziggurat stepping down to a gate with three rosettes.
 *
 * Seven rows, thirteen columns. Splash and /help only — a mark in a working
 * view costs rows on every screen and stops being an event. Rows are returned
 * separately so the caller can colour the stepped roof (bronze/electrum)
 * apart from the gate body.
 */
export const GATE_MARK: readonly string[] = [
  '      ╱╲     ',
  '    ╱──╲     ',
  '  ╱──────╲   ',
  '╱──────────╲ ',
  '┌┴┬─┬─┬─┬─┬┴┐',
  '│ │ │◈│◈│◈│ │',
  '└─┴─┴─┴─┴─┴─┘',
]

/** ASCII-only gate, for terminals without box-drawing support. */
export const GATE_MARK_ASCII: readonly string[] = [
  '      /\\     ',
  '    /--\\     ',
  '  /------\\   ',
  '/----------\\ ',
  '+-+-+-+-+-+-+',
  '| | |*|*|*| |',
  '+-+-+-+-+-+-+',
]

/**
 * One-line identity for every working view. `╱╲` is the gate's roof, so the
 * compact mark is a fragment of the full one rather than an unrelated glyph.
 */
export const MARK_INLINE = '╱╲ UR NEXUS'
export const MARK_INLINE_ASCII = '[UR] NEXUS'

/**
 * The mark needs 7 rows plus a wordmark and still has to leave the composer
 * visible. Below this, the splash uses the inline mark alone.
 */
export const GATE_MARK_MIN_ROWS = 20
export const GATE_MARK_MIN_COLUMNS = 60
