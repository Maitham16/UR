/**
 * UR Nexus colour tokens.
 *
 * One source for the palette, in three tiers so the identity survives on
 * terminals that cannot render it:
 *
 *   trueColor — 24-bit, the reference palette
 *   ansi256   — nearest usable xterm-256 index, chosen by eye rather than by
 *               arithmetic: the naive nearest-neighbour for bronze lands on a
 *               dirty olive, and for lapis on a saturated primary blue
 *   mono      — no colour at all; hierarchy carried by bold/dim/underline
 *
 * Usage rules, which matter more than the values:
 *
 *   limestone  normal readable text
 *   bronze     structure and brand — borders, rules, the mark
 *   electrum   emphasis, roughly one element per region
 *   lapis      focus, selection, active state, links
 *   success/warning/error  state only, never decoration
 *
 * Most borders are `border`, which is nearly invisible on obsidian. That is
 * deliberate: the previous design drew every panel edge in bright bronze, so
 * bronze stopped meaning anything and the screen read as uniformly orange.
 */

export type PaletteToken =
  | 'obsidian'
  | 'elevated'
  | 'surface'
  | 'border'
  | 'bronze'
  | 'bronzeBright'
  | 'electrum'
  | 'lapis'
  | 'lapisLight'
  | 'clay'
  | 'limestone'
  | 'textSecondary'
  | 'textMuted'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'

export const UR_TRUE_COLOR: Record<PaletteToken, string> = {
  obsidian: '#090806',
  elevated: '#100E0B',
  surface: '#17130E',
  border: '#332718',
  bronze: '#A96E2C',
  bronzeBright: '#C98A38',
  electrum: '#D6B35A',
  lapis: '#376D9E',
  lapisLight: '#5591C5',
  clay: '#A45F3E',
  limestone: '#D8D1C2',
  textSecondary: '#989184',
  textMuted: '#6D675E',
  success: '#7FA45B',
  warning: '#D09A3D',
  error: '#C85B4A',
  info: '#5A8EB8',
}

/**
 * xterm-256 indices. Picked for how they read on a dark background, not for
 * minimum RGB distance — several nearest matches are noticeably worse than a
 * neighbour one step away.
 */
export const UR_ANSI_256: Record<PaletteToken, number> = {
  obsidian: 232,
  elevated: 233,
  surface: 234,
  border: 237,
  bronze: 130,
  bronzeBright: 172,
  electrum: 179,
  lapis: 67,
  lapisLight: 74,
  clay: 131,
  limestone: 187,
  textSecondary: 246,
  textMuted: 242,
  success: 107,
  warning: 179,
  error: 167,
  info: 74,
}

/** How a token renders with no colour available. */
export type MonoStyle = {
  bold?: boolean
  dim?: boolean
  underline?: boolean
  inverse?: boolean
}

/**
 * Monochrome fallback. Colour carries five distinctions in this design —
 * structure, emphasis, focus, state, and muting — and only three survive
 * without it, so state collapses onto emphasis and is disambiguated by the
 * inline markers (✓ ! ×) that every notification already carries.
 */
export const UR_MONO: Record<PaletteToken, MonoStyle> = {
  obsidian: {},
  elevated: {},
  surface: {},
  border: { dim: true },
  bronze: { dim: true },
  bronzeBright: {},
  electrum: { bold: true },
  lapis: { underline: true },
  lapisLight: { underline: true, bold: true },
  clay: { dim: true },
  limestone: {},
  textSecondary: { dim: true },
  textMuted: { dim: true },
  success: {},
  warning: { bold: true },
  error: { bold: true, underline: true },
  info: { dim: true },
}

export type ColorDepth = 'truecolor' | 'ansi256' | 'mono'

/**
 * Resolve from the environment. COLORTERM is the only reliable signal for
 * 24-bit support; TERM tells us whether colour exists at all.
 */
export function detectColorDepth(
  env: Record<string, string | undefined> = process.env,
): ColorDepth {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return 'mono'
  const term = env.TERM ?? ''
  if (term === 'dumb' || term === '') return 'mono'
  const colorterm = (env.COLORTERM ?? '').toLowerCase()
  if (colorterm === 'truecolor' || colorterm === '24bit') return 'truecolor'
  if (term.includes('256')) return 'ansi256'
  return 'ansi256'
}

/** `#A96E2C` -> `rgb(169,110,44)`, the form the Theme type stores. */
export function toRgbString(hex: string): string {
  const value = hex.replace('#', '')
  const r = Number.parseInt(value.slice(0, 2), 16)
  const g = Number.parseInt(value.slice(2, 4), 16)
  const b = Number.parseInt(value.slice(4, 6), 16)
  return `rgb(${r},${g},${b})`
}

/** Palette as `rgb(...)` strings, for the Theme type. */
export function urPaletteRgb(): Record<PaletteToken, string> {
  const out = {} as Record<PaletteToken, string>
  for (const [token, hex] of Object.entries(UR_TRUE_COLOR)) {
    out[token as PaletteToken] = toRgbString(hex)
  }
  return out
}

/** Palette as `ansi256:N`, matching the existing `ansi:` convention. */
export function urPaletteAnsi256(): Record<PaletteToken, string> {
  const out = {} as Record<PaletteToken, string>
  for (const [token, index] of Object.entries(UR_ANSI_256)) {
    out[token as PaletteToken] = `ansi256:${index}`
  }
  return out
}
